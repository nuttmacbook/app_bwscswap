function program() {
  /*
   * YOUR CODE (on-chain). wBWSC: the chain's own coin (BWSC) as a token, 1 : 1, like WETH on Ethereum.
   * Pools and other programs work with tokens; wrapping lets the native coin be one.
   *
   *   deposit()          send BWSC as the call's value → you get the same amount of wBWSC
   *   withdraw(amount)   burn amount wBWSC → you get the same amount of BWSC back
   *   transfer / approve / transferFrom / balanceOf / allowance / name / ticker / decimals / totalSupply
   *                      a standard token, so swap pools can hold it
   *   getView(account)   the page's one read: supply, your wBWSC and your BWSC
   *
   * Always backed: every wBWSC in existence was paid for with 1 BWSC that this program holds (totalSupply = coins held).
   * There is no owner and nothing to set: nobody can mint, pause or take the coins. Deploy it WITHOUT an upgrader.
   * Init input (deploy-kit/bwsc/inputs/2-wBWSC.json): { name, ticker, namespace?, description? }. 18 decimals, like BWSC.
   */
  const ZERO = "0x0000000000000000000000000000000000000000"
  const DECIMALS = 18n

  const ABI = {
    functions: [
      { name: "deposit", inputs: [], outputs: [{ name: "balance", type: "uint" }], payable: true, description: "Wrap: send BWSC as value, get the same amount of wBWSC" },
      { name: "withdraw", inputs: [{ name: "amount", type: "uint" }], outputs: [{ name: "balance", type: "uint" }], description: "Unwrap: burn wBWSC, get the same amount of BWSC" },
      { name: "transfer", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint" }], outputs: [{ name: "ok", type: "bool" }] },
      { name: "approve", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint" }], outputs: [{ name: "ok", type: "bool" }] },
      { name: "transferFrom", inputs: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "amount", type: "uint" }], outputs: [{ name: "ok", type: "bool" }] },
      { name: "name", inputs: [], outputs: [{ name: "name", type: "string" }], readonly: true },
      { name: "ticker", inputs: [], outputs: [{ name: "ticker", type: "string" }], readonly: true },
      { name: "decimals", inputs: [], outputs: [{ name: "decimals", type: "uint" }], readonly: true },
      { name: "totalSupply", inputs: [], outputs: [{ name: "supply", type: "uint" }], readonly: true },
      { name: "balanceOf", inputs: [{ name: "who", type: "address" }], outputs: [{ name: "balance", type: "uint" }], readonly: true },
      { name: "allowance", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "amount", type: "uint" }], readonly: true },
      { name: "getView", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "view", type: "object" }], readonly: true },
    ],
    events: [
      { name: "Transfer", fields: [{ name: "from", type: "address", indexed: true }, { name: "to", type: "address", indexed: true }, { name: "amount", type: "uint" }] },
      { name: "Approval", fields: [{ name: "owner", type: "address", indexed: true }, { name: "spender", type: "address", indexed: true }, { name: "amount", type: "uint" }] },
      { name: "Deposit", fields: [{ name: "account", type: "address", indexed: true }, { name: "amount", type: "uint" }] },
      { name: "Withdrawal", fields: [{ name: "account", type: "address", indexed: true }, { name: "amount", type: "uint" }] },
    ],
  }

  /* ------------------------------------------------------------------ checks */

  function requireAddress(value, label) {
    if (typeof value !== "string" || value.length !== 42 || value.slice(0, 2) !== "0x") throw new Error(label + " must be an address")
    return value.toLowerCase()
  }
  function requireAmount(value) {
    if (typeof value !== "bigint" || value <= 0n) throw new Error("amount must be greater than 0")
    return value
  }
  function requireText(value, label, max) {
    if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new Error(label + " must be text of 1 to " + max + " characters")
    return value.trim()
  }
  const nonReentrant = (fn) => (params) => {
    if (readDB("locked")) throw new Error("Busy, try again")
    writeDB("locked", true)
    try { return fn(params) } finally { deleteDB("locked") }
  }

  /* ------------------------------------------------------------------ setup */

  // input: { name, ticker, namespace?, description? }
  function initialization(params) {
    const i = params.input
    writeDB("name", requireText(i.name, "name", 64))
    writeDB("ticker", requireText(i.ticker, "ticker", 16))
    writeDB("totalSupply", 0n)
    setMetadata("abi", ABI)
    if (i.namespace) setMetadata("namespace", i.namespace)
    if (i.description) setMetadata("description", i.description)
  }

  // Runs once when an upgrade is approved (there should be none: deploy without an upgrader)
  function migrate() {
    setMetadata("abi", ABI)
  }

  /* ------------------------------------------------------------------ token */

  const balanceOfAccount = (who) => readDB(map("balances", who)) || 0n

  function name() { return readDB("name") }
  function ticker() { return readDB("ticker") }
  function decimals() { return DECIMALS }
  function totalSupply() { return readDB("totalSupply") || 0n }
  function balanceOf(params) { return balanceOfAccount(requireAddress(params.input.who, "who")) }
  function allowance(params) {
    return readDB(map("allowance", requireAddress(params.input.owner, "owner"), requireAddress(params.input.spender, "spender"))) || 0n
  }

  function move(from, to, amount) {
    requireAmount(amount)
    if (to === ZERO) throw new Error("Use withdraw to turn wBWSC back into BWSC")
    const balance = balanceOfAccount(from)
    if (balance < amount) throw new Error("insufficient balance")
    writeDB(map("balances", from), balance - amount)
    writeDB(map("balances", to), balanceOfAccount(to) + amount)
    emit("Transfer", { from: from, to: to, amount: amount }, { indexed: ["from", "to"] })
  }

  function noValue(params) {
    if ((params.value || 0n) !== 0n) throw new Error("Do not send BWSC with this call (use deposit)")
  }

  function transfer(params) {
    noValue(params)
    move(params.context.sender, requireAddress(params.input.to, "to"), params.input.amount)
    return true
  }

  function approve(params) {
    noValue(params)
    const owner = params.context.sender
    const spender = requireAddress(params.input.spender, "spender")
    const amount = params.input.amount
    if (typeof amount !== "bigint" || amount < 0n) throw new Error("amount must be a whole number of at least 0")
    writeDB(map("allowance", owner, spender), amount)
    emit("Approval", { owner: owner, spender: spender, amount: amount }, { indexed: ["owner", "spender"] })
    return true
  }

  function transferFrom(params) {
    noValue(params)
    const spender = params.context.sender
    const from = requireAddress(params.input.from, "from")
    const amount = requireAmount(params.input.amount)
    const allowed = readDB(map("allowance", from, spender)) || 0n
    if (allowed < amount) throw new Error("insufficient allowance")
    writeDB(map("allowance", from, spender), allowed - amount)
    move(from, requireAddress(params.input.to, "to"), amount)
    return true
  }

  /* ------------------------------------------------------------------ wrap / unwrap */

  const deposit = nonReentrant(function (params) {
    const who = params.context.sender
    const amount = requireAmount(params.value || 0n)
    writeDB(map("balances", who), balanceOfAccount(who) + amount)
    writeDB("totalSupply", totalSupply() + amount)
    emit("Deposit", { account: who, amount: amount }, { indexed: ["account"] })
    emit("Transfer", { from: ZERO, to: who, amount: amount }, { indexed: ["from", "to"] })
    return balanceOfAccount(who)
  })

  const withdraw = nonReentrant(function (params) {
    noValue(params)
    const who = params.context.sender
    const amount = requireAmount(params.input.amount)
    const balance = balanceOfAccount(who)
    if (balance < amount) throw new Error("You have less wBWSC than that")
    // Burn first, then pay
    writeDB(map("balances", who), balance - amount)
    writeDB("totalSupply", totalSupply() - amount)
    emit("Withdrawal", { account: who, amount: amount }, { indexed: ["account"] })
    emit("Transfer", { from: who, to: ZERO, amount: amount }, { indexed: ["from", "to"] })
    transferNative(who, amount)
    return balanceOfAccount(who)
  })

  /* ------------------------------------------------------------------ read */

  // The page's one read. account "" = no wallet (balances 0)
  function getView(params) {
    const raw = params.input.account
    const account = typeof raw === "string" && raw.length === 42 ? raw.toLowerCase() : ""
    return {
      address: ThisAddress(),
      name: readDB("name"),
      symbol: readDB("ticker"),
      decimals: DECIMALS,
      totalSupply: totalSupply(),
      held: ThisBalance(),
      balance: account ? balanceOfAccount(account) : 0n,
      nativeBalance: account ? BalanceOf(account) : 0n,
    }
  }

  return { deposit, withdraw, transfer, approve, transferFrom, name, ticker, decimals, totalSupply, balanceOf, allowance, getView }
}
