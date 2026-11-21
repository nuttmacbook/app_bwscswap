// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/*
 * YOUR CODE. The EVM side of the bridge (BSC today; deploy the same file on any other EVM chain later).
 * BWSC is the hub: every EVM chain bridges with BWSC. Lock and release, running totals.
 * No proxy: deployed as it is and can never be upgraded or changed by anyone, the owner included.
 *
 * Routes: one per token on this chain. token 0x0 = this chain's own coin (BNB on BSC); remoteToken 0x0 = BWSC's native coin.
 *   e.g. BSC-USD -> USDT on BWSC · BWSC (BEP-20) -> native BWSC · BNB -> wBNB on BWSC. setRoute adds or changes one.
 *
 * Going IN (this chain -> BWSC)
 *   bridgeIn(token, amount)   takes the coins (a token: approve first; this chain's coin: send amount as value) and adds
 *                             amount - fee to bridgedIn[you][token]: a running total. The bridge signer reads that total
 *                             and signs it for BWSC, which pays (signed total - already claimed there).
 * Coming OUT (BWSC -> this chain)
 *   claimOut(account, token, total, signature)
 *                             The signer read the running total on BWSC and signed it. This pays total - claimedOut to the
 *                             account. Anyone may send it: the coins always go to `account`. An old signature (smaller
 *                             total) pays nothing, so a signature can never pay twice.
 *
 * Signature: EIP-712, bound to this chain and this contract:
 *   domain  { name: "BwscBridge", version: "2", chainId: this chain, verifyingContract: this }
 *   Claim   { account: address, sourceChainId: uint256 (BWSC), token: address (paid HERE), total: uint256 }
 *
 * Money per token: held = what this contract keeps for it = deposits + liquidity - paid claims - taken out.
 * fees (part of held) belong to the owner; claims and removeLiquidity can use held - fees.
 * Paused = no bridging and no claims (an emergency switch, e.g. for a lost signer key).
 * Coins sent here without addLiquidity are not liquidity: sendOutExtraNative / sendOutExtraToken send back only what is
 * above `held`, never the bridge's own money.
 *
 * Moving from an older bridge (constructor `previous_`, 0x0 = a new bridge)
 *   The running totals of the people who used the old bridge must come along, or they could claim the same coins
 *   again here (claimedOut would start at 0). While the migration is open this bridge stays paused, and
 *   importAccounts(accounts) copies each account's bridgedIn and claimedOut FROM THE OLD CONTRACT (anyone may call
 *   it; nobody can type a number). The old bridge must be paused so its totals no longer move.
 *   closeMigration() ends it for good; then the owner unpauses.
 *
 * Deploy (deploy-kit/README.md): this contract, with the constructor's values.
 */

interface IBridgeERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
}

/** What this bridge reads from the bridge it replaces (an older BwscBridgeEvm) */
interface IPreviousBridge {
    function paused() external view returns (bool);
    function remoteChainId() external view returns (uint256);
    function bridgedInOf(address account, address token) external view returns (uint256);
    function claimedOutOf(address account, address token) external view returns (uint256);
}

contract BridgeConstant {
    uint256 constant VERSION = 3000;
    address constant ZERO = address(0);
    uint256 constant BPS = 10_000;
    uint256 constant MAX_FEE_BPS = 500;   // 5% at most, also for the owner

    bytes32 constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 constant CLAIM_TYPEHASH = keccak256("Claim(address account,uint256 sourceChainId,address token,uint256 total)");
    bytes32 constant NAME_HASH = keccak256("BwscBridge");
    bytes32 constant VERSION_HASH = keccak256("2");
    // Largest allowed s of a signature (lower half of the curve order): blocks the second form of the same signature
    uint256 constant HALF_ORDER = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;
}

contract BridgeStorage is BridgeConstant {
    address _owner;
    address _signer;            // the bridge signer: signs claim totals
    bool _paused;
    bool _locked;               // reentrancy guard
    uint256 _remoteChainId;     // BWSC's chain id

    struct Route {
        bool listed;
        bool enabled;           // false = no new bridgeIn (claims still work)
        address remoteToken;    // the coin on BWSC (0x0 = BWSC's native coin)
        uint256 feeBps;         // fee of bridgeIn
        uint256 min;            // smallest bridgeIn
        uint256 held;           // coins kept here for this token (deposits + liquidity - paid out)
        uint256 fees;           // part of held that belongs to the owner
        uint256 totalBridgedIn; // sum of every bridgedIn (after fees)
        uint256 totalClaimedOut;// sum of every claim paid
    }

    mapping (address => Route) _routes;
    address[] _tokenList;
    mapping (address => mapping (address => uint256)) _bridgedIn;   // account => token => running total (after fees)
    mapping (address => mapping (address => uint256)) _claimedOut;  // account => token => claimed total

    address _previous;          // the bridge this one replaces (0x0 = none)
    bool _migrating;            // true until closeMigration(): totals can still be imported from _previous
}

contract BwscBridgeEvm is BridgeStorage {
    struct RouteView {
        address token;
        address remoteToken;
        bool isNative;
        string symbol;
        uint8 decimals;
        bool enabled;
        uint256 feeBps;
        uint256 min;
        uint256 held;
        uint256 fees;
        uint256 available;      // held - fees: what claims can use
        uint256 actual;         // what this contract really has of it
        uint256 totalBridgedIn;
        uint256 totalClaimedOut;
        uint256 bridgedIn;      // the viewer's running total
        uint256 claimedOut;     // the viewer's claimed total
        uint256 balance;        // the viewer's wallet
        uint256 allowance;      // what the viewer approved this contract to take (tokens)
    }

    struct BridgeView {
        address bridge;
        uint256 chainId;
        uint256 remoteChainId;
        address owner;
        address signer;
        bool paused;
        uint256 maxFeeBps;
        uint256 routeCount;
        RouteView[] routes;
    }

    event BridgeIn(address indexed account, address indexed token, uint256 amount, uint256 fee, uint256 total);
    event ClaimOut(address indexed account, address indexed token, uint256 paid, uint256 total, address by);
    event LiquidityAdded(address indexed token, uint256 amount, address by);
    event LiquidityRemoved(address indexed token, uint256 amount, address to);
    event FeesWithdrawn(address indexed token, uint256 amount, address to);
    event RouteSet(address indexed token, address remoteToken, bool enabled, uint256 feeBps, uint256 min);
    event SignerChanged(address previousSigner, address newSigner);
    event Paused(bool paused);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event SentOutExtra(address indexed to, uint256 amount);
    event ExtraTokenSentOut(address indexed token, address indexed to, uint256 amount);
    event AccountImported(address indexed account, address indexed token, uint256 bridgedIn, uint256 claimedOut);
    event MigrationClosed(address previous);

    modifier onlyOwner() {
        require(_owner == msg.sender, "Only Owner");
        _;
    }

    modifier whenActive() {
        require(!_paused, "Bridge Is Paused");
        _;
    }

    modifier nonReentrant() {
        require(!_locked, "Busy");
        _locked = true;
        _;
        _locked = false;
    }

    /**
     * tokens_[i] (on this chain, 0x0 = its own coin) <-> remoteTokens_[i] (on BWSC, 0x0 = BWSC), with its fee and minimum.
     * Lists may be empty (add routes later with setRoute). previous_ = the bridge this one replaces, or 0x0.
     */
    constructor(
        address owner_,
        address signer_,
        uint256 remoteChainId_,
        address previous_,
        address[] memory tokens_,
        address[] memory remoteTokens_,
        uint256[] memory feeBps_,
        uint256[] memory mins_
    ) {
        require(owner_ != ZERO, "Zero Owner");
        require(signer_ != ZERO, "Zero Signer");
        require(remoteChainId_ != 0 && remoteChainId_ != block.chainid, "Bad Remote Chain");
        require(tokens_.length == remoteTokens_.length && tokens_.length == feeBps_.length && tokens_.length == mins_.length, "Lists Differ In Length");
        _owner = owner_;
        _signer = signer_;
        _remoteChainId = remoteChainId_;
        for (uint256 i; i < tokens_.length; i++) {
            _setRoute(tokens_[i], remoteTokens_[i], true, feeBps_[i], mins_[i]);
        }
        if (previous_ != ZERO) {
            require(previous_.code.length > 0, "Previous Is Not A Contract");
            require(IPreviousBridge(previous_).remoteChainId() == remoteChainId_, "Previous Bridge Has Another Remote Chain");
            _previous = previous_;
            _migrating = true;
            _paused = true;
        }
    }

    /* ------------------------------------ what users do */

    /** Locks `amount` of `token` (approve first; this chain's coin: send it as value) for BWSC; returns your new running total */
    function bridgeIn(address token, uint256 amount) public payable whenActive nonReentrant returns (uint256 total) {
        Route storage t = _routes[token];
        require(t.listed && t.enabled, "Token Cannot Be Bridged");
        require(amount > 0, "Zero Amount");
        require(amount >= t.min, "Below The Smallest Transfer");

        // Count what really arrived (a token that takes a fee on transfer gives less)
        uint256 received = _take(token, msg.sender, amount);
        uint256 fee = (received * t.feeBps) / BPS;
        uint256 net = received - fee;

        _bridgedIn[msg.sender][token] += net;
        t.held += received;
        t.fees += fee;
        t.totalBridgedIn += net;
        total = _bridgedIn[msg.sender][token];
        emit BridgeIn(msg.sender, token, received, fee, total);
    }

    /** Pays `account` the signed running total minus what it already claimed; anyone may send it */
    function claimOut(address account, address token, uint256 total, bytes calldata signature) public whenActive nonReentrant returns (uint256 paid) {
        require(account != ZERO, "Zero Account");
        Route storage t = _routes[token];
        require(t.listed, "Token Not In The Bridge");
        require(_recover(claimDigest(account, token, total), signature) == _signer, "Not Signed By The Bridge Signer");

        uint256 claimed = _claimedOut[account][token];
        require(total > claimed, "Nothing To Claim");
        paid = total - claimed;
        require(paid <= t.held - t.fees, "Not Enough Liquidity Yet");

        // Update the numbers before sending, so the same total can never be paid twice
        _claimedOut[account][token] = total;
        t.held -= paid;
        t.totalClaimedOut += paid;

        _send(token, account, paid);
        emit ClaimOut(account, token, paid, total, msg.sender);
    }

    /** Coins for paying claims (anyone may add; only the owner may take them out) */
    function addLiquidity(address token, uint256 amount) public payable nonReentrant {
        Route storage t = _routes[token];
        require(t.listed, "Token Not In The Bridge");
        require(amount > 0, "Zero Amount");
        uint256 received = _take(token, msg.sender, amount);
        t.held += received;
        emit LiquidityAdded(token, received, msg.sender);
    }

    /* ------------------------------------ what the owner does */

    function removeLiquidity(address token, uint256 amount, address to) public onlyOwner nonReentrant {
        Route storage t = _routes[token];
        require(to != ZERO, "Zero Recipient");
        require(amount > 0, "Zero Amount");
        require(amount <= t.held - t.fees, "More Than The Liquidity");
        t.held -= amount;
        _send(token, to, amount);
        emit LiquidityRemoved(token, amount, to);
    }

    function withdrawFees(address token, address to) public onlyOwner nonReentrant returns (uint256 amount) {
        Route storage t = _routes[token];
        require(to != ZERO, "Zero Recipient");
        amount = t.fees;
        require(amount > 0, "No Fees");
        t.fees = 0;
        t.held -= amount;
        _send(token, to, amount);
        emit FeesWithdrawn(token, amount, to);
    }

    /**
     * Adds a route, or changes one (on/off, fee, smallest transfer); held money is not touched.
     * remoteToken can change only before any money moved on this route: claims are counted per token, so re-pairing
     * after deposits would let the same deposits be claimed again.
     */
    function setRoute(address token, address remoteToken, bool enabled, uint256 feeBps, uint256 min) public onlyOwner {
        _setRoute(token, remoteToken, enabled, feeBps, min);
    }

    function setSigner(address newSigner) public onlyOwner {
        require(newSigner != ZERO, "Zero Signer");
        emit SignerChanged(_signer, newSigner);
        _signer = newSigner;
    }

    function setPaused(bool paused_) public onlyOwner {
        require(paused_ || !_migrating, "Close The Migration First");
        _paused = paused_;
        emit Paused(paused_);
    }

    function transferOwnership(address newOwner) public onlyOwner {
        require(newOwner != ZERO, "Zero Owner");
        emit OwnershipTransferred(_owner, newOwner);
        _owner = newOwner;
    }

    /** This chain's coin that is nobody's (sent here directly): everything above what the native route holds */
    function sendOutExtraNative(address to) external onlyOwner nonReentrant returns (uint256 amount) {
        require(to != ZERO, "Zero Recipient");
        uint256 held = _routes[ZERO].held;
        require(address(this).balance > held, "Nothing To Send");
        amount = address(this).balance - held;
        (bool success, ) = to.call{ value: amount }("");
        require(success, "Transfer Failed");
        emit SentOutExtra(to, amount);
    }

    /** A token sent here without addLiquidity (or one with no route): everything above what its route holds */
    function sendOutExtraToken(address token, address to) external onlyOwner nonReentrant returns (uint256 amount) {
        require(token != ZERO, "Use sendOutExtraNative");
        require(to != ZERO, "Zero Recipient");
        uint256 held = _routes[token].held;
        uint256 balance = IBridgeERC20(token).balanceOf(address(this));
        require(balance > held, "Nothing To Send");
        amount = balance - held;
        _call(token, abi.encodeCall(IBridgeERC20.transfer, (to, amount)));
        emit ExtraTokenSentOut(token, to, amount);
    }

    /* ------------------------------------ moving from the previous bridge */

    /**
     * Copies each account's running totals (every route's token) from the previous bridge. Anyone may call it while the
     * migration is open; the numbers come from the old contract only. Calling it again for an account changes nothing.
     */
    function importAccounts(address[] calldata accounts) external {
        require(_migrating, "No Migration Open");
        IPreviousBridge previous = IPreviousBridge(_previous);
        require(previous.paused(), "Pause The Previous Bridge First");
        uint256 count = _tokenList.length;
        for (uint256 a; a < accounts.length; a++) {
            address account = accounts[a];
            for (uint256 i; i < count; i++) {
                address token = _tokenList[i];
                Route storage t = _routes[token];
                uint256 bridgedIn = previous.bridgedInOf(account, token);
                uint256 claimedOut = previous.claimedOutOf(account, token);
                // This bridge stays paused while migrating, so only imports ever set these numbers
                if (bridgedIn > _bridgedIn[account][token]) {
                    t.totalBridgedIn += bridgedIn - _bridgedIn[account][token];
                    _bridgedIn[account][token] = bridgedIn;
                }
                if (claimedOut > _claimedOut[account][token]) {
                    t.totalClaimedOut += claimedOut - _claimedOut[account][token];
                    _claimedOut[account][token] = claimedOut;
                }
                if (bridgedIn > 0 || claimedOut > 0) emit AccountImported(account, token, bridgedIn, claimedOut);
            }
        }
    }

    /** Ends the migration for good (no more imports); the owner may unpause after it */
    function closeMigration() external onlyOwner {
        require(_migrating, "No Migration Open");
        _migrating = false;
        emit MigrationClosed(_previous);
    }

    /* ------------------------------------ inside */

    function _setRoute(address token, address remoteToken, bool enabled, uint256 feeBps, uint256 min) private {
        require(token == ZERO || token.code.length > 0, "Token Is Not A Contract");
        require(feeBps <= MAX_FEE_BPS, "Fee Too High");
        Route storage t = _routes[token];
        if (!t.listed) {
            t.listed = true;
            _tokenList.push(token);
        } else if (t.remoteToken != remoteToken) {
            require(t.totalBridgedIn == 0 && t.totalClaimedOut == 0, "Route Is Fixed After Use");
        }
        t.remoteToken = remoteToken;
        t.enabled = enabled;
        t.feeBps = feeBps;
        t.min = min;
        emit RouteSet(token, remoteToken, enabled, feeBps, min);
    }

    /** This chain's coin: exactly msg.value. A token: transferFrom, then the amount that really arrived */
    function _take(address token, address from, uint256 amount) private returns (uint256) {
        if (token == ZERO) {
            require(msg.value == amount, "Send Exactly The Amount As Value");
            return amount;
        }
        require(msg.value == 0, "No Value With A Token");
        uint256 before = IBridgeERC20(token).balanceOf(address(this));
        _call(token, abi.encodeCall(IBridgeERC20.transferFrom, (from, address(this), amount)));
        return IBridgeERC20(token).balanceOf(address(this)) - before;
    }

    /** Pays this chain's coin or a token (also tokens that return nothing) */
    function _send(address token, address to, uint256 amount) private {
        if (token == ZERO) {
            (bool success, ) = to.call{ value: amount }("");
            require(success, "Transfer Failed");
            return;
        }
        _call(token, abi.encodeCall(IBridgeERC20.transfer, (to, amount)));
    }

    function _call(address token, bytes memory data) private {
        (bool ok, bytes memory ret) = token.call(data);
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "Transfer Failed");
    }

    /** ecrecover with the usual checks: 65 bytes, low s, v 27/28, not the zero address */
    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address recovered) {
        require(signature.length == 65, "Bad Signature Length");
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "Bad Signature");
        require(uint256(s) <= HALF_ORDER, "Bad Signature");
        recovered = ecrecover(digest, v, r, s);
        require(recovered != ZERO, "Bad Signature");
    }

    /* ------------------------------------ reading */

    function owner() public view returns (address) { return _owner; }
    function signer() public view returns (address) { return _signer; }
    function paused() public view returns (bool) { return _paused; }
    function remoteChainId() public view returns (uint256) { return _remoteChainId; }
    function version() public pure returns (uint256) { return VERSION; }
    function previousBridge() public view returns (address) { return _previous; }
    function migrating() public view returns (bool) { return _migrating; }
    function tokenList() public view returns (address[] memory) { return _tokenList; }
    function bridgedInOf(address account, address token) public view returns (uint256) { return _bridgedIn[account][token]; }
    function claimedOutOf(address account, address token) public view returns (uint256) { return _claimedOut[account][token]; }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    /** The EIP-712 digest the signer signs for a claim here (the coins came from BWSC) */
    function claimDigest(address account, address token, uint256 total) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(CLAIM_TYPEHASH, account, _remoteChainId, token, total));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function getRoute(address token) public view returns (Route memory) {
        return _routes[token];
    }

    /** Everything the bridge page needs from this chain in one call: routes offset .. offset + limit */
    function getBridgeView(address account, uint256 offset, uint256 limit) public view returns (BridgeView memory v) {
        v.bridge = address(this);
        v.chainId = block.chainid;
        v.remoteChainId = _remoteChainId;
        v.owner = _owner;
        v.signer = _signer;
        v.paused = _paused;
        v.maxFeeBps = MAX_FEE_BPS;
        uint256 count = _tokenList.length;
        v.routeCount = count;
        uint256 end = offset + limit > count ? count : offset + limit;
        uint256 size = end > offset ? end - offset : 0;
        v.routes = new RouteView[](size);
        for (uint256 i; i < size; i++) {
            v.routes[i] = _routeView(_tokenList[offset + i], account);
        }
    }

    function _routeView(address token, address account) private view returns (RouteView memory rv) {
        Route storage t = _routes[token];
        bool isNative = token == ZERO;
        rv.token = token;
        rv.remoteToken = t.remoteToken;
        rv.isNative = isNative;
        if (isNative) {
            rv.decimals = 18;
        } else {
            // A token whose symbol / decimals call fails must not break the whole view
            try IBridgeERC20(token).symbol() returns (string memory sym) { rv.symbol = sym; } catch { }
            try IBridgeERC20(token).decimals() returns (uint8 dec) { rv.decimals = dec; } catch { }
        }
        rv.enabled = t.enabled;
        rv.feeBps = t.feeBps;
        rv.min = t.min;
        rv.held = t.held;
        rv.fees = t.fees;
        rv.available = t.held - t.fees;
        rv.actual = isNative ? address(this).balance : _balanceOf(token, address(this));
        rv.totalBridgedIn = t.totalBridgedIn;
        rv.totalClaimedOut = t.totalClaimedOut;
        if (account == ZERO) return rv;
        rv.bridgedIn = _bridgedIn[account][token];
        rv.claimedOut = _claimedOut[account][token];
        rv.balance = isNative ? account.balance : _balanceOf(token, account);
        if (!isNative) {
            try IBridgeERC20(token).allowance(account, address(this)) returns (uint256 a) { rv.allowance = a; } catch { }
        }
    }

    function _balanceOf(address token, address who) private view returns (uint256 b) {
        try IBridgeERC20(token).balanceOf(who) returns (uint256 x) { b = x; } catch { }
    }
}
