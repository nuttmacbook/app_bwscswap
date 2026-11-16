function program() {
  /*
   * YOUR CODE (on-chain). BwscLimit: limit orders, coin for coin, at the price the maker sets.
   *
   * A maker puts up `giveAmount` of one coin and asks `wantAmount` of another ("100 BWSC for 230 USDT"). The coins wait
   * here. Anyone can fill it: the taker pays the asked rate in the want coin, straight to the maker, and receives the
   * give coin from here, less the fee of that coin. Partial fills only if the maker allowed them. The maker can cancel
   * any time (paused or not, expired or not) and gets back what was not filled.
   *
   * Coins: only the ones the owner listed (addCoin), each with its own fee (feeBps, taken from what the taker receives,
   * at most MAX_FEE_BPS). The native coin is 0x0…0. Coins that take a cut on transfer are refused when placing.
   * A coin the owner turned off: no new orders and no fills in it; cancelling always works.
   *
   * Many coins and many orders: every list is stored by number and read a page at a time.
   *   markets   one per direction (give → want), each with its open orders and its best rate kept up to date
   *   orders    by id; per market the open ones; per maker all of theirs (newest first)
   * Open orders per market are capped (MAX_OPEN_PER_MARKET) so keeping the best rate stays cheap.
   * Counters per coin (`held` = what open orders hold, `fees`) must equal what this program holds; tests check it.
   *
   * Times are seconds (block time / 1000). Amounts are bigint in the coin's smallest unit.
   * Init input (deploy-kit/bwsc/inputs/4b-BwscLimit.json): { owner, coins?: [{ token, feeBps }], namespace?, description? }
   */
  const ZERO = "0x0000000000000000000000000000000000000000"
  const BPS = 10000n
  const MAX_FEE_BPS = 500n                 // 5%: the owner can never set more
  const MAX_EXPIRY = 366n * 86400n         // an order ends at most about a year from now (0 = no end)
  const MAX_OPEN_PER_MARKET = 500n
  const MAX_PAGE = 200n

  const ABI = {
    functions: [
      { name: "placeOrder", inputs: [{ name: "give", type: "address" }, { name: "giveAmount", type: "uint" }, { name: "want", type: "address" }, { name: "wantAmount", type: "uint" }, { name: "partial", type: "bool" }, { name: "expiresAt", type: "uint" }], outputs: [{ name: "order", type: "uint" }], payable: true, description: "Put up giveAmount of give and ask wantAmount of want (native coin: send giveAmount as value)" },
      { name: "fill", inputs: [{ name: "order", type: "uint" }, { name: "amount", type: "uint" }], outputs: [{ name: "fill", type: "object" }], payable: true, description: "Take `amount` of the order's give coin, paying the asked rate in its want coin (native: send the price as value)" },
      { name: "cancel", inputs: [{ name: "order", type: "uint" }], outputs: [{ name: "returned", type: "uint" }], payable: true, description: "Maker: end the order and take back what was not filled (always works)" },
      { name: "returnExpired", inputs: [{ name: "order", type: "uint" }], outputs: [{ name: "returned", type: "uint" }], payable: true, description: "Anyone: send an ended order's coins back to its maker" },
      { name: "addCoin", inputs: [{ name: "token", type: "address" }, { name: "feeBps", type: "uint" }], outputs: [], payable: true, description: "Owner: allow a coin (0x0…0 = the native coin) with its fee" },
      { name: "setCoin", inputs: [{ name: "token", type: "address" }, { name: "enabled", type: "bool" }, { name: "feeBps", type: "uint" }], outputs: [], payable: true, description: "Owner: turn a coin on or off, change its fee" },
      { name: "withdrawFees", inputs: [{ name: "token", type: "address" }, { name: "to", type: "address" }], outputs: [{ name: "amount", type: "uint" }], payable: true },
      { name: "setPaused", inputs: [{ name: "paused", type: "bool" }], outputs: [], payable: true },
      { name: "transferOwnership", inputs: [{ name: "owner", type: "address" }], outputs: [], payable: true },
      { name: "getView", inputs: [{ name: "account", type: "address" }, { name: "offset", type: "uint" }, { name: "limit", type: "uint" }], outputs: [{ name: "view", type: "object" }], readonly: true, description: "Settings, the listed coins and a page of markets" },
      { name: "getMarket", inputs: [{ name: "give", type: "address" }, { name: "want", type: "address" }, { name: "account", type: "address" }, { name: "offset", type: "uint" }, { name: "limit", type: "uint" }], outputs: [{ name: "market", type: "object" }], readonly: true, description: "A page of one market's open orders, and the account's balances of its two coins" },
      { name: "getOrdersOf", inputs: [{ name: "account", type: "address" }, { name: "offset", type: "uint" }, { name: "limit", type: "uint" }], outputs: [{ name: "orders", type: "object" }], readonly: true, description: "A page of an account's orders, newest first" },
      { name: "getOrder", inputs: [{ name: "order", type: "uint" }], outputs: [{ name: "order", type: "object" }], readonly: true },
      { name: "priceOf", inputs: [{ name: "order", type: "uint" }, { name: "amount", type: "uint" }], outputs: [{ name: "price", type: "object" }], readonly: true, description: "What filling `amount` costs and pays" },
    ],
    events: [
      { name: "OrderPlaced", fields: [{ name: "order", type: "uint" }, { name: "maker", type: "address", indexed: true }, { name: "give", type: "address" }, { name: "giveAmount", type: "uint" }, { name: "want", type: "address" }, { name: "wantAmount", type: "uint" }, { name: "partial", type: "bool" }, { name: "expiresAt", type: "uint" }] },
      { name: "OrderFilled", fields: [{ name: "order", type: "uint" }, { name: "maker", type: "address", indexed: true }, { name: "taker", type: "address", indexed: true }, { name: "amount", type: "uint" }, { name: "paid", type: "uint" }, { name: "fee", type: "uint" }, { name: "left", type: "uint" }] },
      { name: "OrderClosed", fields: [{ name: "order", type: "uint" }, { name: "maker", type: "address", indexed: true }, { name: "status", type: "string" }, { name: "returned", type: "uint" }] },
      { name: "CoinSet", fields: [{ name: "token", type: "address" }, { name: "enabled", type: "bool" }, { name: "feeBps", type: "uint" }] },
      { name: "FeesWithdrawn", fields: [{ name: "token", type: "address" }, { name: "to", type: "address" }, { name: "amount", type: "uint" }] },
      { name: "Paused", fields: [{ name: "paused", type: "bool" }] },
      { name: "OwnershipTransferred", fields: [{ name: "from", type: "address", indexed: true }, { name: "to", type: "address", indexed: true }] },
    ],
  }

  /* ------------------------------------------------------------------ checks */

  function isAddress(value) {
    return typeof value === "string" && value.length === 42 && value.slice(0, 2) === "0x"
  }
  function requireAddress(value, label) {
    if (!isAddress(value) || value === ZERO) throw new Error(label + " must be an address")
    return value.toLowerCase()
  }
  function requireToken(value, label) {
    if (!isAddress(value)) throw new Error(label + " must be an address (0x0…0 for the native coin)")
    return value.toLowerCase()
  }
  function requireAmount(value, label) {
    if (typeof value !== "bigint" || value <= 0n) throw new Error(label + " must be more than 0")
    return value
  }
  function requireFee(value) {
    if (typeof value !== "bigint" || value < 0n || value > MAX_FEE_BPS) throw new Error("feeBps must be from 0 to " + MAX_FEE_BPS + " (5%)")
    return value
  }
  function requireId(value) {
    if (typeof value !== "bigint" || value < 1n) throw new Error("order must be an order number")
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

  /* ------------------------------------------------------------------ storage */

  const nowOf = (params) => params.block.timestamp / 1000n
  const addTo = (name, k, amount) => writeDB(map(name, k), (readDB(map(name, k)) || 0n) + amount)
  const ceilDiv = (a, b) => (a + b - 1n) / b
  const pageOf = (input) => {
    const offset = typeof input.offset === "bigint" && input.offset > 0n ? input.offset : 0n
    const want = typeof input.limit === "bigint" && input.limit > 0n ? input.limit : 100n
    return { offset: offset, limit: want > MAX_PAGE ? MAX_PAGE : want }
  }

  const coinOf = (token) => readDB(map("coin", token))
  function liveCoin(token, label) {
    const c = coinOf(token)
    if (!c) throw new Error(label + " is not a listed coin")
    if (!c.enabled) throw new Error(label + " is turned off for now")
    return c
  }
  function orderOf(id) {
    const o = readDB(map("order", id))
    if (!o) throw new Error("No order " + id)
    return o
  }
  const marketKey = (give, want) => give + "/" + want

  /** The market of give → want, created the first time someone places an order in it */
  function marketOf(give, want, create) {
    const k = marketKey(give, want)
    const m = readDB(map("market", k))
    if (m || !create) return m
    const count = readDB("marketCount") || 0n
    const fresh = { give: give, want: want, index: count, open: 0n, best: 0n, orders: 0n }
    writeDB(map("marketAt", count), k)
    writeDB("marketCount", count + 1n)
    writeDB(map("market", k), fresh)
    return fresh
  }

  /** Is order a a better deal for the taker than order b? (pays less of `want` per unit of `give`) */
  const better = (a, b) => a.wantAmount * b.giveAmount < b.wantAmount * a.giveAmount

  /** Adds an order to its market's open list (and best rate) */
  function openIn(m, o) {
    if (m.open >= MAX_OPEN_PER_MARKET) throw new Error("This market is full (" + MAX_OPEN_PER_MARKET + " open orders); try again later")
    writeDB(map("openAt", marketKey(m.give, m.want) + "/" + m.open), o.id)
    writeDB(map("openPos", o.id), m.open)
    m.open = m.open + 1n
    m.orders = m.orders + 1n
    if (m.best === 0n || better(o, orderOf(m.best))) m.best = o.id
  }

  /** Takes an order off its market's open list; finds the next best rate when it was the best */
  function closeIn(m, o) {
    const k = marketKey(m.give, m.want)
    const pos = readDB(map("openPos", o.id))
    const last = m.open - 1n
    if (pos !== last) {
      const moved = readDB(map("openAt", k + "/" + last))
      writeDB(map("openAt", k + "/" + pos), moved)
      writeDB(map("openPos", moved), pos)
    }
    deleteDB(map("openAt", k + "/" + last))
    deleteDB(map("openPos", o.id))
    m.open = last
    if (m.best === o.id) {
      m.best = 0n
      let best = null
      for (let n = 0n; n < m.open; n++) {
        const x = orderOf(readDB(map("openAt", k + "/" + n)))
        if (best === null || better(x, best)) best = x
      }
      if (best !== null) m.best = best.id
    }
  }

  /* ------------------------------------------------------------------ moving coins */

  // Takes exactly `amount` from the caller into this program (coins that take a cut on transfer are refused)
  function takeIn(params, token, amount) {
    const value = params.value || 0n
    if (token === ZERO) {
      if (value !== amount) throw new Error("Send exactly the amount as value for the native coin")
      return
    }
    if (value !== 0n) throw new Error("Do not send native coin with a token")
    const balance = () => runProgram(token, "balanceOf", { who: ThisAddress() }, { readonly: true })
    const before = balance()
    runProgram(token, "transferFrom", { from: params.context.sender, to: ThisAddress(), amount: amount })
    if (balance() - before !== amount) throw new Error("This coin takes a cut on transfer; it cannot be used here")
  }
  function pay(token, to, amount) {
    if (amount === 0n) return
    if (token === ZERO) transferNative(to, amount)
    else runProgram(token, "transfer", { to: to, amount: amount })
  }

  /** Ends an order: off its market, the rest back to its maker */
  function close(o, status) {
    const m = marketOf(o.give, o.want, false)
    closeIn(m, o)
    writeDB(map("market", marketKey(o.give, o.want)), m)
    const back = o.left
    o.left = 0n
    o.status = status
    writeDB(map("order", o.id), o)
    addTo("held", o.give, 0n - back)
    emit("OrderClosed", { order: o.id, maker: o.maker, status: status, returned: back }, { indexed: ["maker"] })
    pay(o.give, o.maker, back)
    return back
  }

  /* ------------------------------------------------------------------ setup */

  function initialization(params) {
    writeDB("owner", requireAddress(params.input.owner, "owner"))
    writeDB("paused", false)
    writeDB("orderCount", 0n)
    writeDB("marketCount", 0n)
    writeDB("coinCount", 0n)
    const coins = Array.isArray(params.input.coins) ? params.input.coins : []
    for (const c of coins) listCoin(requireToken(c.token, "coins.token"), requireFee(c.feeBps))
    setMetadata("abi", ABI)
    if (params.input.namespace) setMetadata("namespace", params.input.namespace)
    if (params.input.description) setMetadata("description", params.input.description)
  }

  function migrate() {
    setMetadata("abi", ABI)
  }

  /** A coin's name and decimals, read once when it is listed */
  function listCoin(token, feeBps) {
    if (coinOf(token)) throw new Error("That coin is already listed: use setCoin")
    const read = (fn, fallback) => { try { return runProgram(token, fn, {}, { readonly: true }) } catch (e) { return fallback } }
    const isNative = token === ZERO
    const decimals = isNative ? 18n : read("decimals", null)
    if (typeof decimals !== "bigint") throw new Error("That address is not a token (no decimals)")
    const count = readDB("coinCount") || 0n
    const c = { token: token, symbol: isNative ? "" : String(read("ticker", "")), name: isNative ? "" : String(read("name", "")), decimals: decimals, feeBps: feeBps, enabled: true, index: count }
    writeDB(map("coin", token), c)
    writeDB(map("coinAt", count), token)
    writeDB("coinCount", count + 1n)
    emit("CoinSet", { token: token, enabled: true, feeBps: feeBps })
  }

  /* ------------------------------------------------------------------ write: everyone */

  const placeOrder = nonReentrant(function (params) {
    if (readDB("paused")) throw new Error("Limit orders are paused")
    const i = params.input
    const give = requireToken(i.give, "give")
    const want = requireToken(i.want, "want")
    if (give === want) throw new Error("give and want must be different coins")
    liveCoin(give, "give")
    liveCoin(want, "want")
    const giveAmount = requireAmount(i.giveAmount, "giveAmount")
    const wantAmount = requireAmount(i.wantAmount, "wantAmount")
    const now = nowOf(params)
    const expiresAt = typeof i.expiresAt === "bigint" ? i.expiresAt : 0n
    if (expiresAt !== 0n && (expiresAt <= now || expiresAt > now + MAX_EXPIRY)) throw new Error("expiresAt must be 0 (no end) or a time within a year from now (unix seconds)")
    takeIn(params, give, giveAmount)

    const id = (readDB("orderCount") || 0n) + 1n
    writeDB("orderCount", id)
    const maker = params.context.sender
    const o = { id: id, maker: maker, give: give, want: want, giveAmount: giveAmount, wantAmount: wantAmount, left: giveAmount, received: 0n,
      partial: i.partial !== false, expiresAt: expiresAt, createdAt: now, status: "open", fills: 0n }
    writeDB(map("order", id), o)
    const m = marketOf(give, want, true)
    openIn(m, o)
    writeDB(map("market", marketKey(give, want)), m)
    const mine = readDB(map("makerCount", maker)) || 0n
    writeDB(map("makerAt", maker + "/" + mine), id)
    writeDB(map("makerCount", maker), mine + 1n)
    addTo("held", give, giveAmount)
    emit("OrderPlaced", { order: id, maker: maker, give: give, giveAmount: giveAmount, want: want, wantAmount: wantAmount, partial: o.partial, expiresAt: expiresAt }, { indexed: ["maker"] })
    return id
  })

  /** What filling `amount` of an order costs (want coin, rounded up for the maker) and pays (give coin, less fee) */
  function priceFor(o, amount) {
    const cost = ceilDiv(amount * o.wantAmount, o.giveAmount)
    const c = coinOf(o.give)
    const fee = (amount * (c ? c.feeBps : 0n)) / BPS
    return { amount: amount, cost: cost, fee: fee, receive: amount - fee }
  }

  const fill = nonReentrant(function (params) {
    if (readDB("paused")) throw new Error("Limit orders are paused")
    const o = orderOf(requireId(params.input.order))
    const amount = requireAmount(params.input.amount, "amount")
    const taker = params.context.sender
    if (o.status !== "open") throw new Error("This order is " + o.status)
    if (o.expiresAt !== 0n && nowOf(params) >= o.expiresAt) throw new Error("This order has ended")
    if (taker === o.maker) throw new Error("You cannot fill your own order")
    liveCoin(o.give, "the order's coin")
    liveCoin(o.want, "the asked coin")
    if (amount > o.left) throw new Error("Only " + o.left + " left in this order")
    if (!o.partial && amount !== o.left) throw new Error("This order must be filled all at once")
    const p = priceFor(o, amount)

    // The price goes straight from the taker to the maker
    const value = params.value || 0n
    if (o.want === ZERO) {
      if (value !== p.cost) throw new Error("Send exactly " + p.cost + " as value (the price)")
      transferNative(o.maker, p.cost)
    } else {
      if (value !== 0n) throw new Error("Do not send native coin: this order asks for a token")
      runProgram(o.want, "transferFrom", { from: taker, to: o.maker, amount: p.cost })
    }

    o.left = o.left - amount
    o.received = o.received + p.cost
    o.fills = o.fills + 1n
    addTo("held", o.give, 0n - amount)
    addTo("fees", o.give, p.fee)
    if (o.left === 0n) {
      o.status = "filled"
      const m = marketOf(o.give, o.want, false)
      closeIn(m, o)
      writeDB(map("market", marketKey(o.give, o.want)), m)
    }
    writeDB(map("order", o.id), o)
    emit("OrderFilled", { order: o.id, maker: o.maker, taker: taker, amount: amount, paid: p.cost, fee: p.fee, left: o.left }, { indexed: ["maker", "taker"] })
    if (o.left === 0n) emit("OrderClosed", { order: o.id, maker: o.maker, status: "filled", returned: 0n }, { indexed: ["maker"] })
    pay(o.give, taker, p.receive)
    return { order: o.id, amount: amount, paid: p.cost, fee: p.fee, received: p.receive, left: o.left }
  })

  // Always open: paused or not, ended or not, coin turned off or not
  const cancel = nonReentrant(function (params) {
    const o = orderOf(requireId(params.input.order))
    if (params.context.sender !== o.maker) throw new Error("Only the maker can cancel this order")
    if (o.status !== "open") throw new Error("This order is " + o.status)
    return close(o, "cancelled")
  })

  // An ended order's coins go back to its maker; anyone may send them (keeps markets tidy)
  const returnExpired = nonReentrant(function (params) {
    const o = orderOf(requireId(params.input.order))
    if (o.status !== "open") throw new Error("This order is " + o.status)
    if (o.expiresAt === 0n || nowOf(params) < o.expiresAt) throw new Error("This order has not ended")
    return close(o, "expired")
  })

  /* ------------------------------------------------------------------ write: owner */

  const addCoin = onlyOwner(function (params) {
    listCoin(requireToken(params.input.token, "token"), requireFee(params.input.feeBps))
  })

  const setCoin = onlyOwner(function (params) {
    const token = requireToken(params.input.token, "token")
    const c = coinOf(token)
    if (!c) throw new Error("That coin is not listed: use addCoin")
    c.enabled = params.input.enabled === true
    c.feeBps = requireFee(params.input.feeBps)
    writeDB(map("coin", token), c)
    emit("CoinSet", { token: token, enabled: c.enabled, feeBps: c.feeBps })
  })

  const withdrawFees = onlyOwner(nonReentrant(function (params) {
    const token = requireToken(params.input.token, "token")
    const to = requireAddress(params.input.to, "to")
    const amount = readDB(map("fees", token)) || 0n
    if (amount === 0n) throw new Error("No fees in this coin")
    writeDB(map("fees", token), 0n)
    emit("FeesWithdrawn", { token: token, to: to, amount: amount })
    pay(token, to, amount)
    return amount
  }))

  const setPaused = onlyOwner(function (params) {
    const paused = params.input.paused === true
    writeDB("paused", paused)
    emit("Paused", { paused: paused })
  })

  const transferOwnership = onlyOwner(function (params) {
    const next = requireAddress(params.input.owner, "owner")
    emit("OwnershipTransferred", { from: readDB("owner"), to: next }, { indexed: ["from", "to"] })
    writeDB("owner", next)
  })

  /* ------------------------------------------------------------------ read */

  function balanceOfCoin(token, account) {
    if (!isAddress(account) || account === ZERO) return 0n
    if (token === ZERO) return BalanceOf(account)
    try { return runProgram(token, "balanceOf", { who: account }, { readonly: true }) } catch (e) { return 0n }
  }
  function allowanceOfCoin(token, account) {
    if (token === ZERO || !isAddress(account) || account === ZERO) return 0n
    try { return runProgram(token, "allowance", { owner: account, spender: ThisAddress() }, { readonly: true }) } catch (e) { return 0n }
  }
  const accountOf = (input) => (isAddress(input.account) ? input.account.toLowerCase() : "")
  const coinView = (c) => ({ token: c.token, symbol: c.symbol, name: c.name, decimals: c.decimals, feeBps: c.feeBps, enabled: c.enabled, held: readDB(map("held", c.token)) || 0n, fees: readDB(map("fees", c.token)) || 0n })

  // Settings, every listed coin (light: read from storage) and a page of markets with their best rate
  function getView(params) {
    const page = pageOf(params.input)
    const coins = []
    const coinCount = readDB("coinCount") || 0n
    for (let n = 0n; n < coinCount; n++) coins.push(coinView(coinOf(readDB(map("coinAt", n)))))
    const count = readDB("marketCount") || 0n
    const markets = []
    for (let n = page.offset; n < count && n < page.offset + page.limit; n++) {
      const m = readDB(map("market", readDB(map("marketAt", n))))
      const best = m.best === 0n ? null : orderOf(m.best)
      markets.push({ give: m.give, want: m.want, open: m.open, orders: m.orders,
        best: best ? { order: best.id, giveAmount: best.giveAmount, wantAmount: best.wantAmount, left: best.left, expiresAt: best.expiresAt } : null })
    }
    return {
      limit: ThisAddress(),
      owner: readDB("owner"),
      paused: readDB("paused") === true,
      now: nowOf(params),
      maxFeeBps: MAX_FEE_BPS,
      maxOpenPerMarket: MAX_OPEN_PER_MARKET,
      orderCount: readDB("orderCount") || 0n,
      coins: coins,
      marketCount: count,
      offset: page.offset,
      markets: markets,
      native: { held: readDB(map("held", ZERO)) || 0n, fees: readDB(map("fees", ZERO)) || 0n, balance: ThisBalance() },
    }
  }

  // One market's open orders (a page; the website sorts them by rate), and the account's two balances
  function getMarket(params) {
    const give = requireToken(params.input.give, "give")
    const want = requireToken(params.input.want, "want")
    const account = accountOf(params.input)
    const page = pageOf(params.input)
    const m = marketOf(give, want, false) || { give: give, want: want, open: 0n, orders: 0n, best: 0n }
    const k = marketKey(give, want)
    const orders = []
    for (let n = page.offset; n < m.open && n < page.offset + page.limit; n++) orders.push(orderOf(readDB(map("openAt", k + "/" + n))))
    return {
      give: give, want: want, open: m.open, orders: orders, offset: page.offset, best: m.best, now: nowOf(params),
      account: account,
      // What the account holds of both coins, and what this program may take (for placing in give, filling in want)
      balances: { give: balanceOfCoin(give, account), want: balanceOfCoin(want, account) },
      allowances: { give: allowanceOfCoin(give, account), want: allowanceOfCoin(want, account) },
    }
  }

  function getOrdersOf(params) {
    const account = accountOf(params.input)
    const page = pageOf(params.input)
    const count = account ? readDB(map("makerCount", account)) || 0n : 0n
    const orders = []
    // newest first: offset 0 = the latest order
    for (let n = page.offset; n < count && n < page.offset + page.limit; n++) orders.push(orderOf(readDB(map("makerAt", account + "/" + (count - 1n - n)))))
    return { account: account, count: count, offset: page.offset, orders: orders, now: nowOf(params) }
  }

  function getOrder(params) {
    return orderOf(requireId(params.input.order))
  }

  function priceOf(params) {
    const o = orderOf(requireId(params.input.order))
    return priceFor(o, requireAmount(params.input.amount, "amount"))
  }

  return { placeOrder, fill, cancel, returnExpired, addCoin, setCoin, withdrawFees, setPaused, transferOwnership, getView, getMarket, getOrdersOf, getOrder, priceOf }
}
