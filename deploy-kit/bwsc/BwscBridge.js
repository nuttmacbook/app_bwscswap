function program() {
  /*
   * YOUR CODE (on-chain). BwscBridge: the BWSC hub of the bridge. Every other chain (BSC today, more later) runs
   * BwscBridgeEvm and bridges with this program. Lock and release, running totals.
   *
   * Routes: one per (other chain, coin here). token 0x0…0 = BWSC's native coin; remoteToken 0x0…0 = that chain's coin
   *   (BNB on BSC). Any mix: token ↔ token, native ↔ token, token ↔ native. Examples:
   *     (56, USDT here)  ↔ BSC-USD          (56, 0x0…0 = BWSC) ↔ BWSC as BEP-20 on BSC
   *   The same coin here may have routes to several chains; they share its liquidity.
   *
   * Going OUT (BWSC → chain)
   *   bridgeOut(chainId, token, amount)  locks the coins here (native: send the amount as value; a token: approve first)
   *                             and adds amount − fee to bridgedOut[you][chain][token]: a running total. The signer reads
   *                             it and signs it for that chain, which pays (signed total − already claimed there).
   * Coming IN (chain → BWSC)
   *   claimIn(chainId, account, token, total, signature)
   *                             pays total − claimedIn[account][chain][token] to the account. Anyone may send it: the
   *                             coins always go to `account`. An old signature (smaller total) pays nothing.
   *
   * Signature (EIP-712), the same shape on every chain:
   *   domain  { name: "BwscBridge", version: "2", chainId: this chain, verifyingContract: this program }
   *   Claim   { account: address, sourceChainId: uint256, token: address (paid HERE), total: uint256 }
   *
   * Money: every coin here keeps `held` = locked deposits + liquidity − paid claims − taken out. `fees` (part of held)
   * belong to the owner; claims and removeLiquidity can use held − fees. Paused = no bridging and no claims.
   * Owner: setRoute (add / change a route), add / remove liquidity, withdrawFees, setSigner, setPaused, transferOwnership.
   *
   * Init input (deploy-kit/bwsc/inputs/8-BwscBridge.json): { owner, signer, routes: [{ chainId, token, remoteToken,
   *   feeBps, min }], namespace?, description? }. Amounts are bigint in the coin's smallest unit (native: 18 decimals).
   */
  const ZERO = "0x0000000000000000000000000000000000000000"
  const BPS = 10000n
  const MAX_FEE_BPS = 500n          // 5% at most, also for the owner
  const MAX_PAGE = 100n
  const DOMAIN_NAME = "BwscBridge"
  const DOMAIN_VERSION = "2"
  const CLAIM_TYPES = { Claim: [{ name: "account", type: "address" }, { name: "sourceChainId", type: "uint256" }, { name: "token", type: "address" }, { name: "total", type: "uint256" }] }

  const ABI = {
    functions: [
      { name: "bridgeOut", inputs: [{ name: "chainId", type: "uint" }, { name: "token", type: "address" }, { name: "amount", type: "uint" }], outputs: [{ name: "total", type: "uint" }], payable: true, description: "Lock coins here to receive them on chainId (native coin: send the amount as value)" },
      { name: "claimIn", inputs: [{ name: "chainId", type: "uint" }, { name: "account", type: "address" }, { name: "token", type: "address" }, { name: "total", type: "uint" }, { name: "signature", type: "string" }], outputs: [{ name: "paid", type: "uint" }], description: "Pay out coins bridged in from chainId (signed running total − claimed)" },
      { name: "addLiquidity", inputs: [{ name: "token", type: "address" }, { name: "amount", type: "uint" }], outputs: [], payable: true, description: "Coins for paying claims (native: send the amount as value)" },
      { name: "removeLiquidity", inputs: [{ name: "token", type: "address" }, { name: "amount", type: "uint" }, { name: "to", type: "address" }], outputs: [] },
      { name: "withdrawFees", inputs: [{ name: "token", type: "address" }, { name: "to", type: "address" }], outputs: [{ name: "amount", type: "uint" }] },
      { name: "setRoute", inputs: [{ name: "chainId", type: "uint" }, { name: "token", type: "address" }, { name: "remoteToken", type: "address" }, { name: "enabled", type: "bool" }, { name: "feeBps", type: "uint" }, { name: "min", type: "uint" }], outputs: [], description: "Owner: add or change a route" },
      { name: "setSigner", inputs: [{ name: "signer", type: "address" }], outputs: [] },
      { name: "setPaused", inputs: [{ name: "paused", type: "bool" }], outputs: [] },
      { name: "transferOwnership", inputs: [{ name: "owner", type: "address" }], outputs: [] },
      { name: "sendOutExtraNative", inputs: [{ name: "to", type: "address" }], outputs: [{ name: "amount", type: "uint" }] },
      { name: "bridgedOutOf", inputs: [{ name: "chainId", type: "uint" }, { name: "account", type: "address" }, { name: "token", type: "address" }], outputs: [{ name: "total", type: "uint" }], readonly: true },
      { name: "claimedInOf", inputs: [{ name: "chainId", type: "uint" }, { name: "account", type: "address" }, { name: "token", type: "address" }], outputs: [{ name: "total", type: "uint" }], readonly: true },
      { name: "getRoute", inputs: [{ name: "chainId", type: "uint" }, { name: "token", type: "address" }], outputs: [{ name: "route", type: "object" }], readonly: true },
      { name: "claimDigest", inputs: [{ name: "chainId", type: "uint" }, { name: "account", type: "address" }, { name: "token", type: "address" }, { name: "total", type: "uint" }], outputs: [{ name: "digest", type: "string" }], readonly: true },
      { name: "getView", inputs: [{ name: "account", type: "address" }, { name: "offset", type: "uint" }, { name: "limit", type: "uint" }], outputs: [{ name: "view", type: "object" }], readonly: true },
    ],
    events: [
      { name: "BridgeOut", fields: [{ name: "account", type: "address", indexed: true }, { name: "chainId", type: "uint" }, { name: "token", type: "address", indexed: true }, { name: "amount", type: "uint" }, { name: "fee", type: "uint" }, { name: "total", type: "uint" }] },
      { name: "ClaimIn", fields: [{ name: "account", type: "address", indexed: true }, { name: "chainId", type: "uint" }, { name: "token", type: "address", indexed: true }, { name: "paid", type: "uint" }, { name: "total", type: "uint" }, { name: "by", type: "address" }] },
      { name: "LiquidityAdded", fields: [{ name: "token", type: "address", indexed: true }, { name: "amount", type: "uint" }, { name: "by", type: "address" }] },
      { name: "LiquidityRemoved", fields: [{ name: "token", type: "address", indexed: true }, { name: "amount", type: "uint" }, { name: "to", type: "address" }] },
      { name: "FeesWithdrawn", fields: [{ name: "token", type: "address", indexed: true }, { name: "amount", type: "uint" }, { name: "to", type: "address" }] },
      { name: "RouteSet", fields: [{ name: "chainId", type: "uint" }, { name: "token", type: "address", indexed: true }, { name: "remoteToken", type: "address" }, { name: "enabled", type: "bool" }, { name: "feeBps", type: "uint" }, { name: "min", type: "uint" }] },
      { name: "SignerChanged", fields: [{ name: "from", type: "address" }, { name: "to", type: "address" }] },
      { name: "Paused", fields: [{ name: "paused", type: "bool" }] },
      { name: "OwnershipTransferred", fields: [{ name: "from", type: "address", indexed: true }, { name: "to", type: "address", indexed: true }] },
    ],
  }

  /* ------------------------------------------------------------------ checks */

  function isAddress(value) {
    return typeof value === "string" && value.length === 42 && value.slice(0, 2) === "0x"
  }
  function requireAddress(value, label) {
    if (!isAddress(value) || value.toLowerCase() === ZERO) throw new Error(label + " must be an address")
    return value.toLowerCase()
  }
  // A coin: the zero address means the native coin
  function requireToken(value, label) {
    if (!isAddress(value)) throw new Error(label + " must be an address (0x0…0 for the native coin)")
    return value.toLowerCase()
  }
  function requireAmount(value, label) {
    if (typeof value !== "bigint" || value < 0n) throw new Error(label + " must be a whole number of at least 0")
    return value
  }
  function requireFee(value) {
    if (typeof value !== "bigint" || value < 0n || value > MAX_FEE_BPS) throw new Error("feeBps must be between 0 and 500 (5%)")
    return value
  }
  function requireChain(value) {
    if (typeof value !== "bigint" || value <= 0n) throw new Error("chainId must be a chain id (56 = BSC)")
    if (value === ChainId()) throw new Error("chainId is this chain")
    return value
  }

  const onlyOwner = (fn) => (params) => {
    if (params.context.sender !== readDB("owner")) throw new Error("Only the owner can do this")
    return fn(params)
  }
  const nonReentrant = (fn) => (params) => {
    if (readDB("locked")) throw new Error("Busy, try again")
    writeDB("locked", true)
    try { return fn(params) } finally { deleteDB("locked") }
  }
  const whenActive = (fn) => (params) => {
    if (readDB("paused")) throw new Error("The bridge is paused")
    return fn(params)
  }

  /* ------------------------------------------------------------------ storage */

  const routeKey = (chainId, token) => String(chainId) + ":" + token
  const totalKey = (account, chainId, token) => account + "|" + String(chainId) + "|" + token
  const routeOf = (chainId, token) => readDB(map("route", routeKey(chainId, token))) || null
  const heldOf = (token) => readDB(map("held", token)) || 0n
  const feesOf = (token) => readDB(map("fees", token)) || 0n
  const addTo = (name, k, amount) => writeDB(map(name, k), (readDB(map(name, k)) || 0n) + amount)

  function saveRoute(chainId_, token_, remote_, enabled, feeBps, min) {
    const chainId = requireChain(chainId_)
    const token = requireToken(token_, "token")
    const remoteToken = requireToken(remote_, "remoteToken")
    if (token !== ZERO && !IsProgram(token)) throw new Error("token must be a token program on this chain")
    const k = routeKey(chainId, token)
    const before = routeOf(chainId, token)
    // The other side can change only before any money moved on the route: claims are counted per coin, so
    // re-pairing after deposits would let the same deposits be claimed again
    if (before && before.remoteToken !== remoteToken && (before.totalBridgedOut > 0n || before.totalClaimedIn > 0n)) {
      throw new Error("The route is fixed once coins have moved: list a new coin instead")
    }
    if (!before) {
      const count = readDB("routeCount") || 0n
      writeDB(map("routeAt", count), k)
      writeDB("routeCount", count + 1n)
    }
    const route = { chainId: chainId, token: token, remoteToken: remoteToken, enabled: enabled === true, feeBps: requireFee(feeBps), min: requireAmount(min, "min"),
      totalBridgedOut: before ? before.totalBridgedOut : 0n, totalClaimedIn: before ? before.totalClaimedIn : 0n }
    writeDB(map("route", k), route)
    emit("RouteSet", { chainId: chainId, token: token, remoteToken: remoteToken, enabled: route.enabled, feeBps: feeBps, min: min }, { indexed: ["token"] })
  }

  /* ------------------------------------------------------------------ setup */

  // input: { owner, signer, routes: [{ chainId, token, remoteToken, feeBps, min }], namespace?, description? }
  function initialization(params) {
    const i = params.input
    writeDB("owner", requireAddress(i.owner, "owner"))
    writeDB("signer", requireAddress(i.signer, "signer"))
    writeDB("paused", false)
    writeDB("routeCount", 0n)
    if (!Array.isArray(i.routes)) throw new Error("routes must be a list (it may be empty)")
    for (const r of i.routes) saveRoute(r.chainId, r.token, r.remoteToken, true, r.feeBps, r.min)
    setMetadata("abi", ABI)
    if (i.namespace) setMetadata("namespace", i.namespace)
    if (i.description) setMetadata("description", i.description)
  }

  // Runs once when an upgrade is approved: keeps the ABI in step with the new code
  function migrate() {
    setMetadata("abi", ABI)
  }

  /* ------------------------------------------------------------------ moving coins */

  function pay(token, to, amount) {
    if (amount === 0n) return
    if (token === ZERO) transferNative(to, amount)
    else runProgram(token, "transfer", { to: to, amount: amount })
  }
  // Takes `amount` from the caller and returns what really arrived (a token with a transfer fee gives less).
  // The native coin must come as the call's value, exactly.
  function take(params, token, amount) {
    const value = params.value || 0n
    if (token === ZERO) {
      if (value !== amount) throw new Error("Send exactly the amount as value for the native coin")
      return amount
    }
    if (value !== 0n) throw new Error("Do not send native coin with a token")
    const balance = () => runProgram(token, "balanceOf", { who: ThisAddress() }, { readonly: true })
    const before = balance()
    runProgram(token, "transferFrom", { from: params.context.sender, to: ThisAddress(), amount: amount })
    return balance() - before
  }

  function digestOf(sourceChainId, account, token, total) {
    return eip712Digest(
      { name: DOMAIN_NAME, version: DOMAIN_VERSION, chainId: ChainId(), verifyingContract: ThisAddress() },
      CLAIM_TYPES, "Claim", { account: account, sourceChainId: sourceChainId, token: token, total: total })
  }

  /* ------------------------------------------------------------------ users */

  const bridgeOut = whenActive(nonReentrant(function (params) {
    const who = params.context.sender
    const chainId = requireChain(params.input.chainId)
    const token = requireToken(params.input.token, "token")
    const amount = requireAmount(params.input.amount, "amount")
    const r = routeOf(chainId, token)
    if (!r || !r.enabled) throw new Error("This coin cannot be bridged to that chain")
    if (amount === 0n) throw new Error("amount must be more than 0")
    if (amount < r.min) throw new Error("Below the smallest transfer")
    // Count what really arrived (the guard above keeps anyone from coming back in meanwhile)
    const received = take(params, token, amount)
    const fee = (received * r.feeBps) / BPS
    const net = received - fee
    addTo("bridgedOut", totalKey(who, chainId, token), net)
    addTo("held", token, received)
    addTo("fees", token, fee)
    writeDB(map("route", routeKey(chainId, token)), { ...r, totalBridgedOut: r.totalBridgedOut + net })
    const total = readDB(map("bridgedOut", totalKey(who, chainId, token)))
    emit("BridgeOut", { account: who, chainId: chainId, token: token, amount: received, fee: fee, total: total }, { indexed: ["account", "token"] })
    return total
  }))

  const claimIn = whenActive(nonReentrant(function (params) {
    const i = params.input
    const chainId = requireChain(i.chainId)
    const account = requireAddress(i.account, "account")
    const token = requireToken(i.token, "token")
    const total = requireAmount(i.total, "total")
    if (typeof i.signature !== "string") throw new Error("signature is missing")
    if ((params.value || 0n) !== 0n) throw new Error("Do not send native coin with a claim")
    const r = routeOf(chainId, token)
    if (!r) throw new Error("There is no route for this coin from that chain")
    if (ecrecoverDigest(digestOf(chainId, account, token, total), i.signature) !== readDB("signer")) throw new Error("The signature is not from the bridge signer")
    const k = totalKey(account, chainId, token)
    const claimed = readDB(map("claimedIn", k)) || 0n
    if (total <= claimed) throw new Error("Nothing to claim: this total is already paid")
    const paid = total - claimed
    const held = heldOf(token)
    if (paid > held - feesOf(token)) throw new Error("The bridge does not have enough liquidity for this claim yet")
    writeDB(map("claimedIn", k), total)
    writeDB(map("held", token), held - paid)
    writeDB(map("route", routeKey(chainId, token)), { ...r, totalClaimedIn: r.totalClaimedIn + paid })
    emit("ClaimIn", { account: account, chainId: chainId, token: token, paid: paid, total: total, by: params.context.sender }, { indexed: ["account", "token"] })
    pay(token, account, paid)
    return paid
  }))

  // Coins for paying claims (anyone may add; only the owner may take them out)
  const addLiquidity = nonReentrant(function (params) {
    const token = requireToken(params.input.token, "token")
    const amount = requireAmount(params.input.amount, "amount")
    if (amount === 0n) throw new Error("amount must be more than 0")
    const received = take(params, token, amount)
    addTo("held", token, received)
    emit("LiquidityAdded", { token: token, amount: received, by: params.context.sender }, { indexed: ["token"] })
  })

  /* ------------------------------------------------------------------ owner */

  const removeLiquidity = onlyOwner(nonReentrant(function (params) {
    const token = requireToken(params.input.token, "token")
    const amount = requireAmount(params.input.amount, "amount")
    const to = requireAddress(params.input.to, "to")
    const held = heldOf(token)
    if (amount === 0n) throw new Error("amount must be more than 0")
    if (amount > held - feesOf(token)) throw new Error("More than the liquidity (fees are taken out with withdrawFees)")
    writeDB(map("held", token), held - amount)
    emit("LiquidityRemoved", { token: token, amount: amount, to: to }, { indexed: ["token"] })
    pay(token, to, amount)
  }))

  const withdrawFees = onlyOwner(nonReentrant(function (params) {
    const token = requireToken(params.input.token, "token")
    const to = requireAddress(params.input.to, "to")
    const amount = feesOf(token)
    if (amount === 0n) throw new Error("No fees to withdraw")
    writeDB(map("fees", token), 0n)
    writeDB(map("held", token), heldOf(token) - amount)
    emit("FeesWithdrawn", { token: token, amount: amount, to: to }, { indexed: ["token"] })
    pay(token, to, amount)
    return amount
  }))

  const setRoute = onlyOwner(function (params) {
    const i = params.input
    saveRoute(i.chainId, i.token, i.remoteToken, i.enabled === true, i.feeBps, i.min)
  })

  const setSigner = onlyOwner(function (params) {
    const next = requireAddress(params.input.signer, "signer")
    emit("SignerChanged", { from: readDB("signer"), to: next })
    writeDB("signer", next)
  })

  const setPaused = onlyOwner(function (params) {
    writeDB("paused", params.input.paused === true)
    emit("Paused", { paused: params.input.paused === true })
  })

  const transferOwnership = onlyOwner(function (params) {
    const next = requireAddress(params.input.owner, "owner")
    emit("OwnershipTransferred", { from: readDB("owner"), to: next }, { indexed: ["from", "to"] })
    writeDB("owner", next)
  })

  // Native coin that is not bridge money (sent here by mistake)
  const sendOutExtraNative = onlyOwner(nonReentrant(function (params) {
    const to = requireAddress(params.input.to, "to")
    const extra = ThisBalance() - heldOf(ZERO)
    if (extra <= 0n) throw new Error("Nothing to send out")
    transferNative(to, extra)
    return extra
  }))

  /* ------------------------------------------------------------------ read */

  function bridgedOutOf(params) {
    return readDB(map("bridgedOut", totalKey(requireToken(params.input.account, "account"), params.input.chainId, requireToken(params.input.token, "token")))) || 0n
  }

  function claimedInOf(params) {
    return readDB(map("claimedIn", totalKey(requireToken(params.input.account, "account"), params.input.chainId, requireToken(params.input.token, "token")))) || 0n
  }

  function getRoute(params) {
    return routeOf(params.input.chainId, requireToken(params.input.token, "token"))
  }

  // The digest the signer signs (for checking a signer setup)
  function claimDigest(params) {
    return digestOf(params.input.chainId, requireAddress(params.input.account, "account"), requireToken(params.input.token, "token"), requireAmount(params.input.total, "total"))
  }

  // The bridge page's one read: routes offset … offset + limit (limit ≤ 100), each coin's money once, your totals
  function getView(params) {
    const raw = params.input.account
    const account = isAddress(raw) && raw.toLowerCase() !== ZERO ? raw.toLowerCase() : ""
    const count = readDB("routeCount") || 0n
    const offset = typeof params.input.offset === "bigint" && params.input.offset > 0n ? params.input.offset : 0n
    const want = typeof params.input.limit === "bigint" && params.input.limit > 0n ? params.input.limit : MAX_PAGE
    const limit = want > MAX_PAGE ? MAX_PAGE : want
    const routes = []
    const coins = []
    const seen = []
    const addCoin = (token) => {
      if (seen.indexOf(token) >= 0) return
      seen.push(token)
      const isNative = token === ZERO
      // A token whose call fails must not break the whole view
      const read = (fn, input, fallback) => { try { return runProgram(token, fn, input, { readonly: true }) } catch (e) { return fallback } }
      const held = heldOf(token)
      const fees = feesOf(token)
      coins.push({
        address: token,
        isNative: isNative,
        name: isNative ? "" : read("name", {}, ""),
        symbol: isNative ? "" : read("ticker", {}, ""),
        decimals: isNative ? 18n : read("decimals", {}, 0n),
        held: held,
        fees: fees,
        available: held - fees,
        actual: isNative ? ThisBalance() : read("balanceOf", { who: ThisAddress() }, 0n),
        balance: account ? (isNative ? BalanceOf(account) : read("balanceOf", { who: account }, 0n)) : 0n,
        allowance: account && !isNative ? read("allowance", { owner: account, spender: ThisAddress() }, 0n) : 0n,
      })
    }
    for (let n = offset; n < count && n < offset + limit; n++) {
      const r = readDB(map("route", readDB(map("routeAt", n))))
      const k = account ? totalKey(account, r.chainId, r.token) : ""
      routes.push({
        ...r,
        bridgedOut: account ? readDB(map("bridgedOut", k)) || 0n : 0n,
        claimedIn: account ? readDB(map("claimedIn", k)) || 0n : 0n,
      })
      addCoin(r.token)
    }
    return {
      bridge: ThisAddress(),
      chainId: ChainId(),
      owner: readDB("owner"),
      signer: readDB("signer"),
      paused: readDB("paused") === true,
      maxFeeBps: MAX_FEE_BPS,
      domain: { name: DOMAIN_NAME, version: DOMAIN_VERSION },
      routeCount: count,
      offset: offset,
      routes: routes,
      coins: coins,
    }
  }

  return { bridgeOut, claimIn, addLiquidity, removeLiquidity, withdrawFees, setRoute, setSigner, setPaused, transferOwnership, sendOutExtraNative, bridgedOutOf, claimedInOf, getRoute, claimDigest, getView }
}
