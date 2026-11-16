// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/*
 * YOUR CODE. The BWSC native coin on BSC: a plain BEP-20 with a fixed supply, all minted once to `holder_`.
 * Lock and release: the holder adds the coins to BwscBridgeBsc as liquidity, and the bridge pays them out when
 * native coins are locked on BWSC. Nobody can mint more, so the supply on BSC can never exceed what was minted.
 *
 * Not behind a proxy on purpose: a token whose code can change is a token holders cannot trust.
 * Deploy it only if the coin is not on BSC yet (dev/settings/bsc/BwscBridgeBsc.env NATIVE_TOKEN empty).
 */
contract BwscCoinBsc {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping (address => uint256) public balanceOf;
    mapping (address => mapping (address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_, uint256 supply_, address holder_) {
        require(holder_ != address(0), "Zero Holder");
        require(supply_ > 0, "Zero Supply");
        name = name_;
        symbol = symbol_;
        totalSupply = supply_;
        balanceOf[holder_] = supply_;
        emit Transfer(address(0), holder_, supply_);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "Insufficient Allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) private {
        require(to != address(0), "Zero Address");
        require(balanceOf[from] >= amount, "Insufficient Balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
