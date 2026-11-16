function program() {
  /*
   * YOUR CODE (on-chain). BwscDex: every swap pair in one program, constant product (x · y = k), like Uniswap v2.
   *
   * Pairs
   *   createPair(tokenA, tokenB, feeBps?)   a new pair. tokenA / tokenB are token programs; 0x0…0 means the native
   *                                         coin (BWSC), kept as wBWSC inside (the `wrapped` program), like WETH pairs.
   *                                         Only the owner, unless the owner opened it to everyone (setOpenPairs).
   * Liquidity (fees go to the people who provide it)
   *   addLiquidity(tokenA, tokenB, amountA, amountB, minShares)
   *                                         the first deposit sets the price; later ones take the most of both amounts
   *                                         that keeps it. Native side: send the amount as value; what is not used
   *                                         comes back. Shares are counted per pair, per wallet.
   *   removeLiquidity(tokenA, tokenB, shares, minA, minB)
   *                                         your share of both reserves; name 0x0…0 instead of wBWSC to get native coins
   * Swaps
   *   swap(path, amountIn, minOut)          path = tokens in order, 2 to 4 of them (1 to 3 pairs), e.g.
   *                                         [BWSC (0x0…0), USDT] or [USDT, wBWSC, X]. Native in: send amountIn as value.
   *                                         Native out: the last token 0x0…0. Each pair keeps its fee (feeBps of what
   *                                         goes in), so it grows the value of that pair's shares.
   *   quote(path, amountIn)                 the amounts after every step, without sending anything
   * Owner
   *   setPairFee, setDefaultFee (max 1%), setOpenPairs, setPaused (no swaps, no new liquidity; taking out always works),
   *   transferOwnership, sendOutExtraNative (native coin that is not anyone's)
   * Read
   *   getView(account, offset, limit)       the pages' one read: pairs (a page of them), their tokens with your balances
   *                                         and allowances, your shares
   *   getPair(tokenA, tokenB)               one pair
   *
   * Safety
   * - Reserves are counted here, not read from balances: tokens sent here by mistake never move a price.
   * - Tokens are counted as they really arrive (a token that keeps a fee on transfer gives less, and the pair counts less).
   * - The first deposit of a pair locks MINIMUM_LIQUIDITY shares forever, so one share can never be made too expensive.
   * - One approve per token covers every pair (the allowance is for this program).
   *
   * Init input (deploy-kit/bwsc/inputs/3-BwscDex.json): { owner, wrapped (wBWSC), defaultFeeBps, openPairs?, namespace?, description? }
   * All amounts are bigint in the token's smallest unit.
   */
  const ZERO = "0x0000000000000000000000000000000000000000"
  const BPS = 10000n
  const MAX_FEE_BPS = 100n          // 1% at most, also for the owner
  const MINIMUM_LIQUIDITY = 1000n
  const MAX_PAGE = 100n
  const MAX_HOPS = 3

  const ABI = {
    functions: [
      { name: "createPair", inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }, { name: "feeBps", type: "uint" }], outputs: [{ name: "pair", type: "object" }], description: "A new pair (0x0…0 = the native coin)" },
      { name: "addLiquidity", inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }, { name: "amountA", type: "uint" }, { name: "amountB", type: "uint" }, { name: "minShares", type: "uint" }], outputs: [{ name: "result", type: "object" }], payable: true, description: "Provide liquidity (native side: send the amount as value)" },
      { name: "removeLiquidity", inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }, { name: "shares", type: "uint" }, { name: "minA", type: "uint" }, { name: "minB", type: "uint" }], outputs: [{ name: "result", type: "object" }], description: "Take liquidity out (always works)" },
      { name: "swap", inputs: [{ name: "path", type: "array" }, { name: "amountIn", type: "uint" }, { name: "minOut", type: "uint" }], outputs: [{ name: "amountOut", type: "uint" }], payable: true, description: "Swap along path (native in: send amountIn as value)" },
      { name: "quote", inputs: [{ name: "path", type: "array" }, { name: "amountIn", type: "uint" }], outputs: [{ name: "amounts", type: "array" }], readonly: true },
      { name: "getPair", inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }], outputs: [{ name: "pair", type: "object" }], readonly: true },
      { name: "getView", inputs: [{ name: "account", type: "address" }, { name: "offset", type: "uint" }, { name: "limit", type: "uint" }], outputs: [{ name: "view", type: "object" }], readonly: true },
      { name: "setPairFee", inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }, { name: "feeBps", type: "uint" }], outputs: [] },
      { name: "setDefaultFee", inputs: [{ name: "feeBps", type: "uint" }], outputs: [] },
      { name: "setOpenPairs", inputs: [{ name: "open", type: "bool" }], outputs: [] },
      { name: "setPaused", inputs: [{ name: "paused", type: "bool" }], outputs: [] },
      { name: "transferOwnership", inputs: [{ name: "owner", type: "address" }], outputs: [] },
      { name: "sendOutExtraNative", inputs: [{ name: "to", type: "address" }], outputs: [{ name: "amount", type: "uint" }] },
    ],
    events: [
      { name: "PairCreated", fields: [{ name: "id", type: "string" }, { name: "tokenA", type: "address", indexed: true }, { name: "tokenB", type: "address", indexed: true }, { name: "feeBps", type: "uint" }, { name: "index", type: "uint" }] },
      { name: "Swap", fields: [{ name: "sender", type: "address", indexed: true }, { name: "pair", type: "string" }, { name: "tokenIn", type: "address" }, { name: "amountIn", type: "uint" }, { name: "tokenOut", type: "address" }, { name: "amountOut", type: "uint" }, { name: "fee", type: "uint" }] },
      { name: "AddLiquidity", fields: [{ name: "sender", type: "address", indexed: true }, { name: "pair", type: "string" }, { name: "amountA", type: "uint" }, { name: "amountB", type: "uint" }, { name: "shares", type: "uint" }] },
      { name: "RemoveLiquidity", fields: [{ name: "sender", type: "address", indexed: true }, { name: "pair", type: "string" }, { name: "amountA", type: "uint" }, { name: "amountB", type: "uint" }, { name: "shares", type: "uint" }] },
      { name: "Sync", fields: [{ name: "pair", type: "string" }, { name: "reserveA", type: "uint" }, { name: "reserveB", type: "uint" }] },
      { name: "FeeChanged", fields: [{ name: "pair", type: "string" }, { name: "feeBps", type: "uint" }] },
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
    setMetadata("abi", ABI)
    if (i.namespace) setMetadata("namespace", i.namespace)
    if (i.description) setMetadata("description", i.description)
  }

  // Runs once when an upgrade is approved: keeps the ABI in step with the new code
  function migrate() {
    setMetadata("abi", ABI)
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
  function savePair(p) {
    writeDB(map("pair", p.id), p)
    emit("Sync", { pair: p.id, reserveA: p.reserveA, reserveB: p.reserveB })
  }
  const sharesKey = (id, who) => id + "|" + who
  const sharesOf = (id, who) => readDB(map("shares", sharesKey(id, who))) || 0n
  function addShares(id, who, amount) { writeDB(map("shares", sharesKey(id, who)), sharesOf(id, who) + amount) }

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

  function amountOutFor(amountIn, reserveIn, reserveOut, feeBps) {
    if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n
    const inAfterFee = amountIn * (BPS - feeBps)
    return (inAfterFee * reserveOut) / (reserveIn * BPS + inAfterFee)
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

  // Amounts after each step, from the current reserves
  function amountsFor(keys, amountIn) {
    const amounts = [amountIn]
    for (let n = 0; n < keys.length - 1; n++) {
      const from = keys.at(n)
      const p = requirePair(from, keys.at(n + 1))
      const forward = from === p.tokenA
      amounts.push(amountOutFor(amounts.at(-1), forward ? p.reserveA : p.reserveB, forward ? p.reserveB : p.reserveA, p.feeBps))
    }
    return amounts
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
    const p = { id: id, index: index, tokenA: s.at(0), tokenB: s.at(1), reserveA: 0n, reserveB: 0n, totalShares: 0n, feeBps: feeBps }
    writeDB(map("pair", id), p)
    writeDB(map("pairAt", index), id)
    writeDB("pairCount", index + 1n)
    emit("PairCreated", { id: id, tokenA: p.tokenA, tokenB: p.tokenB, feeBps: feeBps, index: index }, { indexed: ["tokenA", "tokenB"] })
    return p
  })

  /* ------------------------------------------------------------------ liquidity */

  const addLiquidity = whenActive(nonReentrant(function (params) {
    const who = params.context.sender
    const i = params.input
    const value = params.value || 0n
    const nativeA = isNative(i.tokenA)
    const nativeB = isNative(i.tokenB)
    const x = tokenKey(i.tokenA, "tokenA")
    const y = tokenKey(i.tokenB, "tokenB")
    let wantX = requireAmount(i.amountA, "amountA")
    let wantY = requireAmount(i.amountB, "amountB")
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
      addShares(p.id, ZERO, MINIMUM_LIQUIDITY)
      total = MINIMUM_LIQUIDITY
    } else {
      const byA = (gotA * total) / p.reserveA
      const byB = (gotB * total) / p.reserveB
      shares = byA < byB ? byA : byB
    }
    if (shares === 0n) throw new Error("Amounts are too small")
    if (shares < minShares) throw new Error("Price moved: you would get fewer shares than your minimum")
    addShares(p.id, who, shares)
    savePair({ ...p, reserveA: p.reserveA + gotA, reserveB: p.reserveB + gotB, totalShares: total + shares })
    emit("AddLiquidity", { sender: who, pair: p.id, amountA: gotA, amountB: gotB, shares: shares }, { indexed: ["sender"] })
    // The native coin that the price did not need goes back
    const usedNative = nativeIsA ? amountA : nativeIsB ? amountB : 0n
    if (value > usedNative) transferNative(who, value - usedNative)
    return { pair: p.id, amountA: gotA, amountB: gotB, shares: shares }
  }))

  // Always open, even while paused: people can always take their money out
  const removeLiquidity = nonReentrant(function (params) {
    const who = params.context.sender
    const i = params.input
    if ((params.value || 0n) !== 0n) throw new Error("Do not send native coin with removeLiquidity")
    const x = tokenKey(i.tokenA, "tokenA")
    const y = tokenKey(i.tokenB, "tokenB")
    const p = requirePair(x, y)
    const xIsA = x === p.tokenA
    const shares = requireAmount(i.shares, "shares")
    const minX = requireAmount(i.minA || 0n, "minA")
    const minY = requireAmount(i.minB || 0n, "minB")
    const mine = sharesOf(p.id, who)
    if (shares === 0n) throw new Error("shares must be more than 0")
    if (shares > mine) throw new Error("You do not have that many shares")
    const amountA = (shares * p.reserveA) / p.totalShares
    const amountB = (shares * p.reserveB) / p.totalShares
    if (amountA === 0n && amountB === 0n) throw new Error("Shares are too small to withdraw")
    if ((xIsA ? amountA : amountB) < minX || (xIsA ? amountB : amountA) < minY) throw new Error("Price moved: you would get less than your minimum")
    writeDB(map("shares", sharesKey(p.id, who)), mine - shares)
    savePair({ ...p, reserveA: p.reserveA - amountA, reserveB: p.reserveB - amountB, totalShares: p.totalShares - shares })
    emit("RemoveLiquidity", { sender: who, pair: p.id, amountA: amountA, amountB: amountB, shares: shares }, { indexed: ["sender"] })
    const nativeIsA = (isNative(i.tokenA) && xIsA) || (isNative(i.tokenB) && !xIsA)
    const nativeIsB = (isNative(i.tokenA) && !xIsA) || (isNative(i.tokenB) && xIsA)
    payOut(p.tokenA, nativeIsA, who, amountA)
    payOut(p.tokenB, nativeIsB, who, amountB)
    return { pair: p.id, amountA: xIsA ? amountA : amountB, amountB: xIsA ? amountB : amountA, shares: shares }
  })

  /* ------------------------------------------------------------------ swap */

  const swap = whenActive(nonReentrant(function (params) {
    const who = params.context.sender
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
    let amount = takeIn(keys.at(0), nativeIn, who, amountIn)
    for (let n = 0; n < keys.length - 1; n++) {
      const from = keys.at(n)
      const to = keys.at(n + 1)
      const p = requirePair(from, to)
      const forward = from === p.tokenA
      const reserveIn = forward ? p.reserveA : p.reserveB
      const reserveOut = forward ? p.reserveB : p.reserveA
      if (reserveIn === 0n || reserveOut === 0n) throw new Error("A pair on the path has no liquidity yet")
      const out = amountOutFor(amount, reserveIn, reserveOut, p.feeBps)
      if (out === 0n) throw new Error("Amount is too small to swap")
      savePair({ ...p, reserveA: forward ? p.reserveA + amount : p.reserveA - out, reserveB: forward ? p.reserveB - out : p.reserveB + amount })
      emit("Swap", { sender: who, pair: p.id, tokenIn: from, amountIn: amount, tokenOut: to, amountOut: out, fee: (amount * p.feeBps) / BPS }, { indexed: ["sender"] })
      amount = out
    }
    if (amount < minOut) throw new Error("Price moved: you would get less than your minimum")
    payOut(keys.at(-1), nativeOut, who, amount)
    return amount
  }))

  /* ------------------------------------------------------------------ owner */

  const setPairFee = onlyOwner(function (params) {
    const p = requirePair(tokenKey(params.input.tokenA, "tokenA"), tokenKey(params.input.tokenB, "tokenB"))
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

  /* ------------------------------------------------------------------ read */

  function quote(params) {
    return amountsFor(pathKeys(params.input.path), requireAmount(params.input.amountIn, "amountIn"))
  }

  function pairView(p, account) {
    return { ...p, myShares: account ? sharesOf(p.id, account) : 0n }
  }

  function getPair(params) {
    const p = pairOf(pairId(tokenKey(params.input.tokenA, "tokenA"), tokenKey(params.input.tokenB, "tokenB")))
    return p ? pairView(p, "") : null
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
      owner: readDB("owner"),
      wrapped: readDB("wrapped"),
      paused: readDB("paused") === true,
      openPairs: readDB("openPairs") === true,
      defaultFeeBps: readDB("defaultFeeBps"),
      maxFeeBps: MAX_FEE_BPS,
      minimumLiquidity: MINIMUM_LIQUIDITY,
      maxHops: BigInt(MAX_HOPS),
      pairCount: count,
      offset: offset,
      pairs: pairs,
      tokens: tokens,
      nativeBalance: account ? BalanceOf(account) : 0n,
    }
  }

  return { createPair, addLiquidity, removeLiquidity, swap, quote, getPair, getView, setPairFee, setDefaultFee, setOpenPairs, setPaused, transferOwnership, sendOutExtraNative }
}
