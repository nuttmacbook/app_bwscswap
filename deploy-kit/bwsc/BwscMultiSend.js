function program() {
  /*
   * YOUR CODE (on-chain). BwscMultiSend: send a coin to many wallets in one transaction.
   *
   * send({ token, transfers: [{ to, amount }, …] })
   *   native coin (token 0x0…0): attach the total as value; every wallet gets its amount from it, nothing is left here
   *   a token: approve this program for the total first; each amount goes straight from you to the wallet
   *            (transferFrom, so the coins never sit in this program)
   * All or nothing: if one transfer fails, none happen. At most MAX_TRANSFERS wallets per transaction; the website
   * splits longer lists into several transactions.
   *
   * No owner, no fee, nothing to pause and nothing held: deploy it without an upgrader so no one can ever change it.
   * Init input (deploy-kit/bwsc/inputs/4c-BwscMultiSend.json): { namespace?, description? }
   */
  const ZERO = "0x0000000000000000000000000000000000000000"
  const MAX_TRANSFERS = 200n

  const ABI = {
    functions: [
      { name: "send", inputs: [{ name: "token", type: "address" }, { name: "transfers", type: "array" }], outputs: [{ name: "sent", type: "object" }], payable: true, description: "Send `token` (0x0…0 = the native coin, attach the total as value) to many wallets: transfers = [{ to, amount }]" },
      { name: "getView", inputs: [{ name: "account", type: "address" }, { name: "token", type: "address" }], outputs: [{ name: "view", type: "object" }], readonly: true, description: "The limit per transaction, the account's balance and allowance of the token, its native balance (for the fee) and the base fee" },
    ],
    events: [
      { name: "MultiSent", fields: [{ name: "sender", type: "address", indexed: true }, { name: "token", type: "address", indexed: true }, { name: "count", type: "uint" }, { name: "total", type: "uint" }] },
    ],
  }

  function isAddress(value) {
    return typeof value === "string" && value.length === 42 && value.slice(0, 2) === "0x"
  }

  /** Checks the whole list before anything moves: every row a wallet and an amount above 0 */
  function readList(transfers) {
    if (!Array.isArray(transfers) || transfers.length === 0) throw new Error("transfers must list at least one { to, amount }")
    if (BigInt(transfers.length) > MAX_TRANSFERS) throw new Error("At most " + MAX_TRANSFERS + " transfers in one transaction")
    const rows = []
    let total = 0n
    let n = 0n
    for (const item of transfers) {
      n = n + 1n
      const to = item && item.to
      const amount = item && item.amount
      if (!isAddress(to) || to === ZERO) throw new Error("Row " + n + ": to must be a wallet address")
      if (typeof amount !== "bigint" || amount <= 0n) throw new Error("Row " + n + ": amount must be more than 0")
      rows.push({ to: to.toLowerCase(), amount: amount })
      total = total + amount
    }
    return { rows: rows, total: total }
  }

  function initialization(params) {
    setMetadata("abi", ABI)
    if (params.input.namespace) setMetadata("namespace", params.input.namespace)
    if (params.input.description) setMetadata("description", params.input.description)
  }

  function migrate() {
    setMetadata("abi", ABI)
  }

  function send(params) {
    if (!isAddress(params.input.token)) throw new Error("token must be an address (0x0…0 for the native coin)")
    const token = params.input.token.toLowerCase()
    const sender = params.context.sender
    const list = readList(params.input.transfers)
    const value = params.value || 0n
    if (token === ZERO) {
      if (value !== list.total) throw new Error("Attach exactly the total (" + list.total + ") as value")
      for (const r of list.rows) transferNative(r.to, r.amount)
    } else {
      if (value !== 0n) throw new Error("Do not attach native coin when sending a token")
      for (const r of list.rows) runProgram(token, "transferFrom", { from: sender, to: r.to, amount: r.amount })
    }
    const count = BigInt(list.rows.length)
    emit("MultiSent", { sender: sender, token: token, count: count, total: list.total }, { indexed: ["sender", "token"] })
    return { token: token, count: count, total: list.total }
  }

  function getView(params) {
    const account = isAddress(params.input.account) ? params.input.account.toLowerCase() : ""
    const token = isAddress(params.input.token) ? params.input.token.toLowerCase() : ZERO
    const read = (fn, input, fallback) => { try { return runProgram(token, fn, input, { readonly: true }) } catch (e) { return fallback } }
    const isNative = token === ZERO
    return {
      maxTransfers: MAX_TRANSFERS,
      token: token,
      decimals: isNative ? 18n : read("decimals", {}, null),
      symbol: isNative ? "" : String(read("ticker", {}, "")),
      balance: account === "" ? 0n : isNative ? BalanceOf(account) : read("balanceOf", { who: account }, 0n),
      allowance: account === "" || isNative ? 0n : read("allowance", { owner: account, spender: ThisAddress() }, 0n),
      gasBalance: account === "" ? 0n : BalanceOf(account),
      baseFee: BaseFee(),
    }
  }

  return { send, getView }
}
