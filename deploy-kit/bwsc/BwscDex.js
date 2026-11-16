function program() {
  /*
   * YOUR CODE (on-chain). BwscDex v2: every swap pair in one program, constant product (x · y = k), like Uniswap v2.
   * Made to be deployed once and used for a long time: every money-moving call takes a deadline, a minimum (or
   * maximum) and a receiver, so wallets, bots and other programs can use it safely at any volume.
   *
   * Common inputs
   *   deadline   unix seconds. A transaction that lands in a block after it is refused ("Expired"), so a signed swap
   *              that waited too long in a busy queue can never fill at an old price. 0 / left out = no deadline.
   *   to         who receives the coins / shares (left out = the caller)
   *   0x0…0      the native coin (BWSC). Pairs hold it as wBWSC (the `wrapped` program); people send and get BWSC.
   *
   * Pairs
   *   createPair(tokenA, tokenB, feeBps?)   a new pair. Only the owner, unless the owner opened it (setOpenPairs).
   * Liquidity (swap fees go to the people who provide it)
   *   addLiquidity(tokenA, tokenB, amountA, amountB, minShares, to?, deadline?)
   *                                         the first deposit sets the price; later ones take the most of both
   *                                         amounts that keeps it. Native side: send the amount as value, the part
   *                                         not used comes back. Shares are counted per pair, per wallet.
   *                                         Returns { pair, amountA, amountB, shares }: amounts in the order you named.
   *   removeLiquidity(tokenA, tokenB, shares, minA, minB, to?, deadline?)
   *                                         your part of both reserves (0x0…0 instead of wBWSC = native coins).
   *                                         Works even while paused.
   *   transferShares(tokenA, tokenB, to, shares)          move a position to another wallet
   *   approveShares(tokenA, tokenB, spender, shares)      let a program (a farm, a locker) move up to `shares`
   *   transferSharesFrom(tokenA, tokenB, from, to, shares)
   * Swaps (path = tokens in order, 2 to 4 of them = 1 to 3 pairs; native only first or last)
   *   swap(path, amountIn, minOut, to?, deadline?)         exact in: pay amountIn, get at least minOut
   *   swapExactOut(path, amountOut, maxIn, to?, deadline?) exact out: get exactly amountOut, pay at most maxIn.
   *                                         Native in: send maxIn as value, the part not used comes back.
   *   quote(path, amountIn)                 amounts after each step for an exact-in swap
   *   quoteIn(path, amountOut)              amounts for an exact-out swap (the first one is what you pay)
   * Prices for other programs (time-weighted, like Uniswap v2)
   *   every pair keeps priceACumulative / priceBCumulative (price × 1e18, summed over seconds) and cumulativeAt.
   *   Read getPair twice and divide the difference by the seconds between: a price no single block can move.
   * Owner (limited on purpose: the owner can never take anyone's coins or shares)
   *   setPairFee / setDefaultFee (max 1%), setOpenPairs, setPaused (no swaps / new liquidity; taking out always
   *   works), transferOwnership, sendOutExtraNative (native coin sent here by mistake),
   *   skim(token, to) (tokens sent here by mistake: only what is above every pair's reserves)
   * Read
   *   getView(account, offset, limit)       the pages' one read: pairs (a page), their tokens with your balances and
   *                                         allowances, your shares, the block time
   *   getPair(tokenA, tokenB) · sharesOf(tokenA, tokenB, who) · sharesAllowance(tokenA, tokenB, owner, spender)
   *
   * Safety
   * - Reserves are counted here, not read from balances: tokens sent here by mistake never move a price.
   * - Tokens are counted as they really arrive (a token that keeps a fee on transfer gives less, and counts less).
   * - The first deposit of a pair locks MINIMUM_LIQUIDITY shares forever, so one share can never be made too dear.
   * - One approve per token covers every pair (the allowance is for this program). Calls cannot nest (lock).
   *
   * Upgrading from v1: the storage is the same; migrate() adds what v1 did not keep (token totals, price sums).
   * Init input (deploy-kit/bwsc/inputs/3-BwscDex.json): { owner, wrapped (wBWSC), defaultFeeBps, openPairs?, namespace?, description? }
   * All amounts are bigint in the token's smallest unit.
   */
  const VERSION = 2n
  const ZERO = "0x0000000000000000000000000000000000000000"
  const BPS = 10000n
  const PRICE_ONE = 1000000000000000000n   // prices in the cumulative sums are × 1e18
  const MAX_FEE_BPS = 100n                 // 1% at most, also for the owner
  const MINIMUM_LIQUIDITY = 1000n
  const MAX_PAGE = 100n
  const MAX_HOPS = 3

  const a = (name) => ({ name: name, type: "address" })
  const u = (name) => ({ name: name, type: "uint" })
  const ABI = {
    functions: [
      { name: "createPair", inputs: [a("tokenA"), a("tokenB"), u("feeBps")], outputs: [{ name: "pair", type: "object" }], description: "A new pair (0x0…0 = the native coin)" },
      { name: "addLiquidity", inputs: [a("tokenA"), a("tokenB"), u("amountA"), u("amountB"), u("minShares"), a("to"), u("deadline")], outputs: [{ name: "result", type: "object" }], payable: true, description: "Provide liquidity (native side: send the amount as value). deadline = unix seconds" },
      { name: "removeLiquidity", inputs: [a("tokenA"), a("tokenB"), u("shares"), u("minA"), u("minB"), a("to"), u("deadline")], outputs: [{ name: "result", type: "object" }], description: "Take liquidity out (always works)" },
      { name: "swap", inputs: [{ name: "path", type: "array" }, u("amountIn"), u("minOut"), a("to"), u("deadline")], outputs: [u("amountOut")], payable: true, description: "Exact in: pay amountIn, get at least minOut (native in: send amountIn as value)" },
      { name: "swapExactOut", inputs: [{ name: "path", type: "array" }, u("amountOut"), u("maxIn"), a("to"), u("deadline")], outputs: [u("amountIn")], payable: true, description: "Exact out: get amountOut, pay at most maxIn (native in: send maxIn as value, the rest comes back)" },
      { name: "transferShares", inputs: [a("tokenA"), a("tokenB"), a("to"), u("shares")], outputs: [] },
      { name: "approveShares", inputs: [a("tokenA"), a("tokenB"), a("spender"), u("shares")], outputs: [] },
      { name: "transferSharesFrom", inputs: [a("tokenA"), a("tokenB"), a("from"), a("to"), u("shares")], outputs: [] },
      { name: "quote", inputs: [{ name: "path", type: "array" }, u("amountIn")], outputs: [{ name: "amounts", type: "array" }], readonly: true },
      { name: "quoteIn", inputs: [{ name: "path", type: "array" }, u("amountOut")], outputs: [{ name: "amounts", type: "array" }], readonly: true },
      { name: "getPair", inputs: [a("tokenA"), a("tokenB")], outputs: [{ name: "pair", type: "object" }], readonly: true },
      { name: "sharesOf", inputs: [a("tokenA"), a("tokenB"), a("who")], outputs: [u("shares")], readonly: true },
      { name: "sharesAllowance", inputs: [a("tokenA"), a("tokenB"), a("owner"), a("spender")], outputs: [u("shares")], readonly: true },
      { name: "getView", inputs: [a("account"), u("offset"), u("limit")], outputs: [{ name: "view", type: "object" }], readonly: true },
      { name: "setPairFee", inputs: [a("tokenA"), a("tokenB"), u("feeBps")], outputs: [] },
      { name: "setDefaultFee", inputs: [u("feeBps")], outputs: [] },
      { name: "setOpenPairs", inputs: [{ name: "open", type: "bool" }], outputs: [] },
      { name: "setPaused", inputs: [{ name: "paused", type: "bool" }], outputs: [] },
      { name: "transferOwnership", inputs: [a("owner")], outputs: [] },
      { name: "sendOutExtraNative", inputs: [a("to")], outputs: [u("amount")] },
      { name: "skim", inputs: [a("token"), a("to")], outputs: [u("amount")], description: "Tokens sent here by mistake (above every pair's reserves)" },
    ],
    events: [
      { name: "PairCreated", fields: [{ name: "id", type: "string" }, { name: "tokenA", type: "address", indexed: true }, { name: "tokenB", type: "address", indexed: true }, u("feeBps"), u("index")] },
      { name: "Swap", fields: [{ name: "sender", type: "address", indexed: true }, { name: "pair", type: "string" }, a("tokenIn"), u("amountIn"), a("tokenOut"), u("amountOut"), u("fee"), { name: "to", type: "address", indexed: true }] },
      { name: "AddLiquidity", fields: [{ name: "sender", type: "address", indexed: true }, { name: "pair", type: "string" }, u("amountA"), u("amountB"), u("shares"), { name: "to", type: "address", indexed: true }] },
      { name: "RemoveLiquidity", fields: [{ name: "sender", type: "address", indexed: true }, { name: "pair", type: "string" }, u("amountA"), u("amountB"), u("shares"), { name: "to", type: "address", indexed: true }] },
      { name: "TransferShares", fields: [{ name: "pair", type: "string" }, { name: "from", type: "address", indexed: true }, { name: "to", type: "address", indexed: true }, u("shares")] },
      { name: "ApproveShares", fields: [{ name: "pair", type: "string" }, { name: "owner", type: "address", indexed: true }, { name: "spender", type: "address", indexed: true }, u("shares")] },
      { name: "Sync", fields: [{ name: "pair", type: "string" }, u("reserveA"), u("reserveB")] },
      { name: "FeeChanged", fields: [{ name: "pair", type: "string" }, u("feeBps")] },
      { name: "Skim", fields: [a("token"), a("to"), u("amount")] },
      { name: "Paused", fields: [{ name: "paused", type: "bool" }] },
      { name: "OpenPairs", fields: [{ name: "open", type: "bool" }] },
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
  function requireAmount(value, label) {
    if (typeof value !== "bigint" || value < 0n) throw new Error(label + " must be a whole number of at least 0")
    return value
  }
  function requireFee(value) {
    if (typeof value !== "bigint" || value < 0n || value > MAX_FEE_BPS) throw new Error("feeBps must be between 0 and 100 (1%)")
    return value
  }
  // A token as the caller names it: 0x0…0 is the native coin, which pairs hold as wBWSC
  function tokenKey(value, label) {
    if (!isAddress(value)) throw new Error(label + " must be an address (0x0…0 for the native coin)")
    const t = value.toLowerCase()
    return t === ZERO ? readDB("wrapped") : t
  }
  const isNative = (value) => isAddress(value) && value.toLowerCase() === ZERO
  const nowOf = (params) => params.block.timestamp / 1000n
  // The receiver: `to` when given, else the caller
  function receiverOf(params) {
    const to = params.input.to
    if (to === undefined || to === null || to === "") return params.context.sender
    return requireAddress(to, "to")
  }
  // deadline: unix seconds; 0 / left out = none. Seconds sent as milliseconds by mistake are refused.
  function checkDeadline(params) {
    const d = params.input.deadline
    if (d === undefined || d === null || d === 0n) return
    if (typeof d !== "bigint" || d < 0n) throw new Error("deadline must be unix seconds")
    if (d >= 100000000000n) throw new Error("deadline looks like milliseconds: send unix seconds")
    if (nowOf(params) > d) throw new Error("Expired: the deadline passed before the transaction was in a block")
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
    if (readDB("paused")) throw new Error("Swaps are paused")
    return fn(params)
  }

  /* ------------------------------------------------------------------ setup */

  // input: { owner, wrapped, defaultFeeBps, openPairs?, namespace?, description? }
  function initialization(params) {
    const i = params.input
    writeDB("owner", requireAddress(i.owner, "owner"))
    const wrapped = requireAddress(i.wrapped, "wrapped (the wBWSC program)")
    if (!IsProgram(wrapped)) throw new Error("wrapped must be the wBWSC program")
    writeDB("wrapped", wrapped)
    writeDB("defaultFeeBps", requireFee(i.defaultFeeBps))
    writeDB("openPairs", i.openPairs === true)
    writeDB("paused", false)
    writeDB("pairCount", 0n)
    writeDB("version", VERSION)
    setMetadata("abi", ABI)
    if (i.namespace) setMetadata("namespace", i.namespace)
    if (i.description) setMetadata("description", i.description)
  }

  // Runs once when an upgrade is approved: the ABI, and from v1 the token totals that skim needs
  function migrate() {
    setMetadata("abi", ABI)
    if (readDB("version") === VERSION) return
    const count = readDB("pairCount") || 0n
    const totals = []
    const add = (token, amount) => {
      const at = totals.findIndex((x) => x.token === token)
      if (at < 0) totals.push({ token: token, amount: amount })
      else totals.at(at).amount = totals.at(at).amount + amount
    }
    for (let n = 0n; n < count; n++) {
      const p = pairOf(readDB(map("pairAt", n)))
      add(p.tokenA, p.reserveA)
      add(p.tokenB, p.reserveB)
    }
    totals.forEach((x) => writeDB(map("held", x.token), x.amount))
    writeDB("version", VERSION)
  }

  /* ------------------------------------------------------------------ storage */

  // A pair's id: its two token addresses in sorted order, "a/b" (a < b)
  function sorted(x, y) { return x < y ? [x, y] : [y, x] }
  function pairId(x, y) { const s = sorted(x, y); return s.at(0) + "/" + s.at(1) }
  const pairOf = (id) => readDB(map("pair", id)) || null
  function requirePair(x, y) {
    const p = pairOf(pairId(x, y))
    if (!p) throw new Error("There is no pair for these two tokens")
    return p
  }
  const sharesKey = (id, who) => id + "|" + who
  const sharesOfKey = (id, who) => readDB(map("shares", sharesKey(id, who))) || 0n
  function setShares(id, who, amount) { writeDB(map("shares", sharesKey(id, who)), amount) }
  const allowanceKey = (id, owner, spender) => id + "|" + owner + "|" + spender
  const sharesAllowanceOf = (id, owner, spender) => readDB(map("sharesAllowance", allowanceKey(id, owner, spender))) || 0n

  // Every token's total in all reserves: skim may only send out what is above it
  const heldOf = (token) => readDB(map("held", token)) || 0n
  function addHeld(token, delta) { writeDB(map("held", token), heldOf(token) + delta) }

  // Time-weighted price sums, brought up to `now` with the reserves as they were (before this block's change)
  function accrue(p, now) {
    const last = p.cumulativeAt || 0n
    const out = { ...p, priceACumulative: p.priceACumulative || 0n, priceBCumulative: p.priceBCumulative || 0n, cumulativeAt: now }
    if (last === 0n || now <= last || p.reserveA === 0n || p.reserveB === 0n) return out
    const dt = now - last
    out.priceACumulative = out.priceACumulative + ((p.reserveB * PRICE_ONE) / p.reserveA) * dt
    out.priceBCumulative = out.priceBCumulative + ((p.reserveA * PRICE_ONE) / p.reserveB) * dt
    return out
  }

  // Saves a pair with new reserves: price sums first, token totals follow the change
  function savePair(p, now, reserveA, reserveB) {
    const next = { ...accrue(p, now), reserveA: reserveA, reserveB: reserveB }
    addHeld(p.tokenA, reserveA - p.reserveA)
    addHeld(p.tokenB, reserveB - p.reserveB)
    writeDB(map("pair", p.id), next)
    emit("Sync", { pair: p.id, reserveA: reserveA, reserveB: reserveB })
    return next
  }

  // Name, ticker and decimals of a token, read once when its first pair is made
  function tokenInfo(token) {
    const known = readDB(map("token", token))
    if (known) return known
    if (!IsProgram(token)) throw new Error(token + " is not a token program")
    const read = (fn) => runProgram(token, fn, {}, { readonly: true })
    const info = { address: token, name: String(read("name")), symbol: String(read("ticker")), decimals: BigInt(read("decimals")) }
    writeDB(map("token", token), info)
    return info
  }

  /* ------------------------------------------------------------------ moving coins */

  const balanceHere = (token) => runProgram(token, "balanceOf", { who: ThisAddress() }, { readonly: true })

  // Takes `amount` of `token` from `from` (or wraps native value) and returns what really arrived
  function takeIn(token, nativeIn, from, amount) {
    if (amount === 0n) return 0n
    if (nativeIn) {
      runProgram(readDB("wrapped"), "deposit", {}, { value: amount })
      return amount
    }
    const before = balanceHere(token)
    runProgram(token, "transferFrom", { from: from, to: ThisAddress(), amount: amount })
    return balanceHere(token) - before
  }
  // Pays `amount` of `token` to `to`, or unwraps it and pays native coins
  function payOut(token, nativeOut, to, amount) {
    if (amount === 0n) return
    if (nativeOut) {
      runProgram(readDB("wrapped"), "withdraw", { amount: amount })
      transferNative(to, amount)
    } else {
      runProgram(token, "transfer", { to: to, amount: amount })
    }
  }

  /* ------------------------------------------------------------------ math */

  function sqrt(value) {
    if (value < 2n) return value
    let x = value
    let y = (x + 1n) / 2n
    while (y < x) {
      x = y
      y = (x + value / x) / 2n
    }
    return x
  }

  // Exact in: what comes out for `amountIn` (fee taken from what goes in)
  function amountOutFor(amountIn, reserveIn, reserveOut, feeBps) {
    if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n
    const inAfterFee = amountIn * (BPS - feeBps)
    return (inAfterFee * reserveOut) / (reserveIn * BPS + inAfterFee)
  }
  // Exact out: the least that must go in to get `amountOut` (rounded up, so amountOutFor(result) ≥ amountOut)
  function amountInFor(amountOut, reserveIn, reserveOut, feeBps) {
    if (amountOut <= 0n) throw new Error("amountOut must be more than 0")
    if (reserveIn <= 0n || reserveOut <= 0n) throw new Error("A pair on the path has no liquidity yet")
    if (amountOut >= reserveOut) throw new Error("Not enough liquidity for that amount")
    return (reserveIn * amountOut * BPS) / ((reserveOut - amountOut) * (BPS - feeBps)) + 1n
  }

  // [tokens with native mapped to wBWSC], checked: 2 to MAX_HOPS + 1 tokens, native only at the ends, no repeats
  function pathKeys(path) {
    if (!Array.isArray(path) || path.length < 2 || path.length > MAX_HOPS + 1) throw new Error("path must list 2 to 4 tokens")
    const keys = path.map((t, n) => {
      if (isNative(t) && n !== 0 && n !== path.length - 1) throw new Error("The native coin can only start or end a path")
      return tokenKey(t, "path")
    })
    keys.forEach((k, n) => { if (keys.indexOf(k) !== n) throw new Error("A token appears twice in the path") })
    return keys
  }

  // Reserves of one step, in the direction of the swap
  function step(from, to) {
    const p = requirePair(from, to)
    const forward = from === p.tokenA
    return { p: p, forward: forward, reserveIn: forward ? p.reserveA : p.reserveB, reserveOut: forward ? p.reserveB : p.reserveA }
  }

  // Exact in: amounts after each step, from the current reserves
  function amountsOut(keys, amountIn) {
    const amounts = [amountIn]
    for (let n = 0; n < keys.length - 1; n++) {
      const s = step(keys.at(n), keys.at(n + 1))
      amounts.push(amountOutFor(amounts.at(-1), s.reserveIn, s.reserveOut, s.p.feeBps))
    }
    return amounts
  }
  // Exact out: amounts from the end back to the start; the first is what must be paid
  function amountsIn(keys, amountOut) {
    const amounts = [amountOut]
    for (let n = keys.length - 1; n > 0; n--) {
      const s = step(keys.at(n - 1), keys.at(n))
      amounts.unshift(amountInFor(amounts.at(0), s.reserveIn, s.reserveOut, s.p.feeBps))
    }
    return amounts
  }

  // Runs `amount` of keys[0] (already here) through every pair; returns what comes out at the end
  function runPath(keys, amount, who, to, now) {
    let moving = amount
    for (let n = 0; n < keys.length - 1; n++) {
      const from = keys.at(n)
      const next = keys.at(n + 1)
      const s = step(from, next)
      if (s.reserveIn === 0n || s.reserveOut === 0n) throw new Error("A pair on the path has no liquidity yet")
      const out = amountOutFor(moving, s.reserveIn, s.reserveOut, s.p.feeBps)
      if (out === 0n) throw new Error("Amount is too small to swap")
      savePair(s.p, now, s.forward ? s.p.reserveA + moving : s.p.reserveA - out, s.forward ? s.p.reserveB - out : s.p.reserveB + moving)
      emit("Swap", { sender: who, pair: s.p.id, tokenIn: from, amountIn: moving, tokenOut: next, amountOut: out, fee: (moving * s.p.feeBps) / BPS, to: to }, { indexed: ["sender", "to"] })
      moving = out
    }
    return moving
  }

  /* ------------------------------------------------------------------ pairs */

  const createPair = nonReentrant(function (params) {
    if (readDB("openPairs") !== true && params.context.sender !== readDB("owner")) throw new Error("Only the owner can add pairs")
    if ((params.value || 0n) !== 0n) throw new Error("Do not send native coin with createPair")
    const x = tokenKey(params.input.tokenA, "tokenA")
    const y = tokenKey(params.input.tokenB, "tokenB")
    if (x === y) throw new Error("tokenA and tokenB must be different")
    const id = pairId(x, y)
    if (pairOf(id)) throw new Error("This pair already exists")
    const s = sorted(x, y)
    tokenInfo(s.at(0))
    tokenInfo(s.at(1))
    const fee = params.input.feeBps === undefined || params.input.feeBps === null ? readDB("defaultFeeBps") : requireFee(params.input.feeBps)
    // Only the owner picks a fee; anyone else gets the default
    const feeBps = params.context.sender === readDB("owner") ? fee : readDB("defaultFeeBps")
    const index = readDB("pairCount") || 0n
    const p = { id: id, index: index, tokenA: s.at(0), tokenB: s.at(1), reserveA: 0n, reserveB: 0n, totalShares: 0n, feeBps: feeBps,
      priceACumulative: 0n, priceBCumulative: 0n, cumulativeAt: 0n }
    writeDB(map("pair", id), p)
    writeDB(map("pairAt", index), id)
    writeDB("pairCount", index + 1n)
    emit("PairCreated", { id: id, tokenA: p.tokenA, tokenB: p.tokenB, feeBps: feeBps, index: index }, { indexed: ["tokenA", "tokenB"] })
    return p
  })

  /* ------------------------------------------------------------------ liquidity */

  const addLiquidity = whenActive(nonReentrant(function (params) {
    checkDeadline(params)
    const who = params.context.sender
    const to = receiverOf(params)
    const i = params.input
    const value = params.value || 0n
    const nativeA = isNative(i.tokenA)
    const nativeB = isNative(i.tokenB)
    const x = tokenKey(i.tokenA, "tokenA")
    const y = tokenKey(i.tokenB, "tokenB")
    const wantX = requireAmount(i.amountA, "amountA")
    const wantY = requireAmount(i.amountB, "amountB")
    const minShares = requireAmount(i.minShares || 0n, "minShares")
    if (wantX === 0n || wantY === 0n) throw new Error("Both amounts must be more than 0")
    if (nativeA && value !== wantX) throw new Error("Send exactly amountA as value for the native coin")
    if (nativeB && value !== wantY) throw new Error("Send exactly amountB as value for the native coin")
    if (!nativeA && !nativeB && value !== 0n) throw new Error("Do not send native coin with two tokens")
    const p = requirePair(x, y)
    // In the pair's own order (tokenA < tokenB)
    const xIsA = x === p.tokenA
    const wantA = xIsA ? wantX : wantY
    const wantB = xIsA ? wantY : wantX
    let amountA = wantA
    let amountB = wantB
    if (p.totalShares > 0n) {
      // The most of both amounts that keeps the current price
      const neededB = (wantA * p.reserveB) / p.reserveA
      if (neededB <= wantB) amountB = neededB
      else amountA = (wantB * p.reserveA) / p.reserveB
    }
    const nativeIsA = (nativeA && xIsA) || (nativeB && !xIsA)
    const nativeIsB = (nativeA && !xIsA) || (nativeB && xIsA)
    const gotA = takeIn(p.tokenA, nativeIsA, who, amountA)
    const gotB = takeIn(p.tokenB, nativeIsB, who, amountB)
    let shares = 0n
    let total = p.totalShares
    if (total === 0n) {
      shares = sqrt(gotA * gotB)
      if (shares <= MINIMUM_LIQUIDITY) throw new Error("First deposit is too small")
      shares = shares - MINIMUM_LIQUIDITY
      setShares(p.id, ZERO, sharesOfKey(p.id, ZERO) + MINIMUM_LIQUIDITY)
      total = MINIMUM_LIQUIDITY
    } else {
      const byA = (gotA * total) / p.reserveA
      const byB = (gotB * total) / p.reserveB
      shares = byA < byB ? byA : byB
    }
    if (shares === 0n) throw new Error("Amounts are too small")
    if (shares < minShares) throw new Error("Price moved: you would get fewer shares than your minimum")
    setShares(p.id, to, sharesOfKey(p.id, to) + shares)
    savePair({ ...p, totalShares: total + shares }, nowOf(params), p.reserveA + gotA, p.reserveB + gotB)
    emit("AddLiquidity", { sender: who, pair: p.id, amountA: gotA, amountB: gotB, shares: shares, to: to }, { indexed: ["sender", "to"] })
    // The native coin that the price did not need goes back to the caller
    const usedNative = nativeIsA ? amountA : nativeIsB ? amountB : 0n
    if (value > usedNative) transferNative(who, value - usedNative)
    return { pair: p.id, amountA: xIsA ? gotA : gotB, amountB: xIsA ? gotB : gotA, shares: shares }
  }))

  // Always open, even while paused: people can always take their money out
  const removeLiquidity = nonReentrant(function (params) {
    checkDeadline(params)
    const who = params.context.sender
    const to = receiverOf(params)
    const i = params.input
    if ((params.value || 0n) !== 0n) throw new Error("Do not send native coin with removeLiquidity")
    const x = tokenKey(i.tokenA, "tokenA")
    const y = tokenKey(i.tokenB, "tokenB")
    const p = requirePair(x, y)
    const xIsA = x === p.tokenA
    const shares = requireAmount(i.shares, "shares")
    const minX = requireAmount(i.minA || 0n, "minA")
    const minY = requireAmount(i.minB || 0n, "minB")
    const mine = sharesOfKey(p.id, who)
    if (shares === 0n) throw new Error("shares must be more than 0")
    if (shares > mine) throw new Error("You do not have that many shares")
    const amountA = (shares * p.reserveA) / p.totalShares
    const amountB = (shares * p.reserveB) / p.totalShares
    if (amountA === 0n && amountB === 0n) throw new Error("Shares are too small to withdraw")
    if ((xIsA ? amountA : amountB) < minX || (xIsA ? amountB : amountA) < minY) throw new Error("Price moved: you would get less than your minimum")
    setShares(p.id, who, mine - shares)
    savePair({ ...p, totalShares: p.totalShares - shares }, nowOf(params), p.reserveA - amountA, p.reserveB - amountB)
    emit("RemoveLiquidity", { sender: who, pair: p.id, amountA: amountA, amountB: amountB, shares: shares, to: to }, { indexed: ["sender", "to"] })
    const nativeIsA = (isNative(i.tokenA) && xIsA) || (isNative(i.tokenB) && !xIsA)
    const nativeIsB = (isNative(i.tokenA) && !xIsA) || (isNative(i.tokenB) && xIsA)
    payOut(p.tokenA, nativeIsA, to, amountA)
    payOut(p.tokenB, nativeIsB, to, amountB)
    return { pair: p.id, amountA: xIsA ? amountA : amountB, amountB: xIsA ? amountB : amountA, shares: shares }
  })

  /* ------------------------------------------------------------------ shares (positions) */

  function moveShares(id, from, to, shares) {
    if (typeof shares !== "bigint" || shares <= 0n) throw new Error("shares must be more than 0")
    if (to === from) throw new Error("to must be another address")
    const have = sharesOfKey(id, from)
    if (shares > have) throw new Error("Not that many shares")
    setShares(id, from, have - shares)
    setShares(id, to, sharesOfKey(id, to) + shares)
    emit("TransferShares", { pair: id, from: from, to: to, shares: shares }, { indexed: ["from", "to"] })
  }
  const pairFromInput = (i) => requirePair(tokenKey(i.tokenA, "tokenA"), tokenKey(i.tokenB, "tokenB"))

  const transferShares = nonReentrant(function (params) {
    if ((params.value || 0n) !== 0n) throw new Error("Do not send native coin with transferShares")
    const p = pairFromInput(params.input)
    moveShares(p.id, params.context.sender, requireAddress(params.input.to, "to"), params.input.shares)
  })

  const approveShares = nonReentrant(function (params) {
    if ((params.value || 0n) !== 0n) throw new Error("Do not send native coin with approveShares")
    const p = pairFromInput(params.input)
    const spender = requireAddress(params.input.spender, "spender")
    const shares = requireAmount(params.input.shares, "shares")
    writeDB(map("sharesAllowance", allowanceKey(p.id, params.context.sender, spender)), shares)
    emit("ApproveShares", { pair: p.id, owner: params.context.sender, spender: spender, shares: shares }, { indexed: ["owner", "spender"] })
  })

  const transferSharesFrom = nonReentrant(function (params) {
    if ((params.value || 0n) !== 0n) throw new Error("Do not send native coin with transferSharesFrom")
    const p = pairFromInput(params.input)
    const from = requireAddress(params.input.from, "from")
    const spender = params.context.sender
    const shares = requireAmount(params.input.shares, "shares")
    const allowed = sharesAllowanceOf(p.id, from, spender)
    if (shares > allowed) throw new Error("Not that many shares approved")
    writeDB(map("sharesAllowance", allowanceKey(p.id, from, spender)), allowed - shares)
    moveShares(p.id, from, requireAddress(params.input.to, "to"), shares)
  })

  /* ------------------------------------------------------------------ swap */

  const swap = whenActive(nonReentrant(function (params) {
    checkDeadline(params)
    const who = params.context.sender
    const to = receiverOf(params)
    const path = params.input.path
    const keys = pathKeys(path)
    const amountIn = requireAmount(params.input.amountIn, "amountIn")
    const minOut = requireAmount(params.input.minOut || 0n, "minOut")
    const value = params.value || 0n
    const nativeIn = isNative(path.at(0))
    const nativeOut = isNative(path.at(-1))
    if (amountIn === 0n) throw new Error("amountIn must be more than 0")
    if (nativeIn && value !== amountIn) throw new Error("Send exactly amountIn as value for the native coin")
    if (!nativeIn && value !== 0n) throw new Error("Do not send native coin unless the path starts with it")
    const got = takeIn(keys.at(0), nativeIn, who, amountIn)
    const out = runPath(keys, got, who, to, nowOf(params))
    if (out < minOut) throw new Error("Price moved: you would get less than your minimum")
    payOut(keys.at(-1), nativeOut, to, out)
    return out
  }))

  const swapExactOut = whenActive(nonReentrant(function (params) {
    checkDeadline(params)
    const who = params.context.sender
    const to = receiverOf(params)
    const path = params.input.path
    const keys = pathKeys(path)
    const amountOut = requireAmount(params.input.amountOut, "amountOut")
    const maxIn = requireAmount(params.input.maxIn, "maxIn")
    const value = params.value || 0n
    const nativeIn = isNative(path.at(0))
    const nativeOut = isNative(path.at(-1))
    if (amountOut === 0n) throw new Error("amountOut must be more than 0")
    if (nativeIn && value !== maxIn) throw new Error("Send exactly maxIn as value for the native coin (the rest comes back)")
    if (!nativeIn && value !== 0n) throw new Error("Do not send native coin unless the path starts with it")
    const need = amountsIn(keys, amountOut).at(0)
    if (need > maxIn) throw new Error("Price moved: you would pay more than your maximum")
    const got = takeIn(keys.at(0), nativeIn, who, need)
    if (got < need) throw new Error("This token keeps a fee on transfer: use swap (exact in) instead")
    const out = runPath(keys, got, who, to, nowOf(params))
    if (out < amountOut) throw new Error("Price moved: you would get less than asked")
    payOut(keys.at(-1), nativeOut, to, out)
    if (nativeIn && value > need) transferNative(who, value - need)
    return need
  }))

  /* ------------------------------------------------------------------ owner */

  const setPairFee = onlyOwner(function (params) {
    const p = pairFromInput(params.input)
    const feeBps = requireFee(params.input.feeBps)
    writeDB(map("pair", p.id), { ...p, feeBps: feeBps })
    emit("FeeChanged", { pair: p.id, feeBps: feeBps })
  })

  const setDefaultFee = onlyOwner(function (params) {
    writeDB("defaultFeeBps", requireFee(params.input.feeBps))
    emit("FeeChanged", { pair: "", feeBps: params.input.feeBps })
  })

  const setOpenPairs = onlyOwner(function (params) {
    writeDB("openPairs", params.input.open === true)
    emit("OpenPairs", { open: params.input.open === true })
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

  // Pairs never hold native coins (they hold wBWSC), so any native coin here was sent by mistake
  const sendOutExtraNative = onlyOwner(nonReentrant(function (params) {
    const to = requireAddress(params.input.to, "to")
    const amount = ThisBalance()
    if (amount === 0n) throw new Error("Nothing to send out")
    transferNative(to, amount)
    return amount
  }))

  // Tokens sent here by mistake: only what is above the total of every pair's reserves of that token
  const skim = onlyOwner(nonReentrant(function (params) {
    const token = requireAddress(params.input.token, "token")
    const to = requireAddress(params.input.to, "to")
    if (!IsProgram(token)) throw new Error("token must be a token program")
    const extra = balanceHere(token) - heldOf(token)
    if (extra <= 0n) throw new Error("Nothing extra to send out")
    runProgram(token, "transfer", { to: to, amount: extra })
    emit("Skim", { token: token, to: to, amount: extra })
    return extra
  }))

  /* ------------------------------------------------------------------ read */

  function quote(params) {
    return amountsOut(pathKeys(params.input.path), requireAmount(params.input.amountIn, "amountIn"))
  }

  function quoteIn(params) {
    return amountsIn(pathKeys(params.input.path), requireAmount(params.input.amountOut, "amountOut"))
  }

  function pairView(p, account) {
    return { ...p, priceACumulative: p.priceACumulative || 0n, priceBCumulative: p.priceBCumulative || 0n, cumulativeAt: p.cumulativeAt || 0n,
      myShares: account ? sharesOfKey(p.id, account) : 0n }
  }

  function getPair(params) {
    const p = pairOf(pairId(tokenKey(params.input.tokenA, "tokenA"), tokenKey(params.input.tokenB, "tokenB")))
    if (!p) return null
    // Price sums brought up to this block, so two reads a while apart give the average price in between
    const now = params.block && params.block.timestamp ? nowOf(params) : 0n
    return pairView(now ? accrue(p, now) : p, "")
  }

  function sharesOf(params) {
    const p = pairOf(pairId(tokenKey(params.input.tokenA, "tokenA"), tokenKey(params.input.tokenB, "tokenB")))
    return p && isAddress(params.input.who) ? sharesOfKey(p.id, params.input.who.toLowerCase()) : 0n
  }

  function sharesAllowance(params) {
    const p = pairOf(pairId(tokenKey(params.input.tokenA, "tokenA"), tokenKey(params.input.tokenB, "tokenB")))
    if (!p || !isAddress(params.input.owner) || !isAddress(params.input.spender)) return 0n
    return sharesAllowanceOf(p.id, params.input.owner.toLowerCase(), params.input.spender.toLowerCase())
  }

  // The pages' one read. Pairs offset … offset + limit (limit ≤ 100), and every token in them once
  function getView(params) {
    const raw = params.input.account
    const account = isAddress(raw) && raw.toLowerCase() !== ZERO ? raw.toLowerCase() : ""
    const count = readDB("pairCount") || 0n
    const offset = typeof params.input.offset === "bigint" && params.input.offset > 0n ? params.input.offset : 0n
    const want = typeof params.input.limit === "bigint" && params.input.limit > 0n ? params.input.limit : MAX_PAGE
    const limit = want > MAX_PAGE ? MAX_PAGE : want
    const pairs = []
    const tokens = []
    const seen = []
    const addToken = (address) => {
      if (seen.indexOf(address) >= 0) return
      seen.push(address)
      const info = readDB(map("token", address))
      const read = (fn, input) => { try { return runProgram(address, fn, input, { readonly: true }) } catch (e) { return 0n } }
      tokens.push({
        ...info,
        held: read("balanceOf", { who: ThisAddress() }),
        balance: account ? read("balanceOf", { who: account }) : 0n,
        allowance: account ? read("allowance", { owner: account, spender: ThisAddress() }) : 0n,
      })
    }
    for (let n = offset; n < count && n < offset + limit; n++) {
      const p = pairOf(readDB(map("pairAt", n)))
      pairs.push(pairView(p, account))
      addToken(p.tokenA)
      addToken(p.tokenB)
    }
    return {
      dex: ThisAddress(),
      version: VERSION,
      owner: readDB("owner"),
      wrapped: readDB("wrapped"),
      paused: readDB("paused") === true,
      openPairs: readDB("openPairs") === true,
      defaultFeeBps: readDB("defaultFeeBps"),
      maxFeeBps: MAX_FEE_BPS,
      minimumLiquidity: MINIMUM_LIQUIDITY,
      maxHops: BigInt(MAX_HOPS),
      // The chain's clock: pages set deadlines from it, not from the visitor's computer
      blockTime: params.block && params.block.timestamp ? nowOf(params) : 0n,
      pairCount: count,
      offset: offset,
      pairs: pairs,
      tokens: tokens,
      nativeBalance: account ? BalanceOf(account) : 0n,
    }
  }

  return { createPair, addLiquidity, removeLiquidity, swap, swapExactOut, transferShares, approveShares, transferSharesFrom,
    quote, quoteIn, getPair, sharesOf, sharesAllowance, getView,
    setPairFee, setDefaultFee, setOpenPairs, setPaused, transferOwnership, sendOutExtraNative, skim }
}
