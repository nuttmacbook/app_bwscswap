# deploy-kit/ 🗑️ ลบทั้งโฟลเดอร์นี้ออกจากแอปได้

โฟลเดอร์นี้มี 2 อย่าง
- **โปรแกรมที่คุณก้อปไปดีพลอยเอง**
- **โค้ดชั่วคราว** (เทสกับเชนจำลอง)

เว็บไม่ได้ใช้อะไรในนี้เลย ดีพลอยเสร็จและใส่แอดเดรสใน `settings/config.js` แล้ว ลบ `deploy-kit/` ทิ้งได้ เว็บยัง build และใช้งานได้ตามปกติ

```
deploy-kit/
├── bwsc/                  📋 ก้อปไปวางใน explorer ของเชน (https://syncblock.network → Deploy)
│   ├── Token.js           เหรียญมาตรฐานของเชน (ใช้กับ USDT บน BWSC)
│   ├── WBWSC.js           wBWSC: BWSC แบบ token 1 : 1 (wrap / unwrap) ไม่มี owner
│   ├── BwscDex.js         ตลาดแลกเหรียญ v2: ทุกคู่อยู่ในโปรแกรมเดียว (token↔token, token↔BWSC) ค่าธรรมเนียมเข้า LP · deadline, exact out, ผู้รับ, LP โอนได้, TWAP, skim
│   ├── BwscStaking.js     staking 2 เฟส ทุกแบบ (ฝาก native/token รับ native/token) กี่ pool ก็ได้
│   ├── BwscBridge.js      bridge ศูนย์กลางบน BWSC: เส้นทางต่อ (เชน, เหรียญ) ไปได้หลายเชน
│   └── inputs/            Init input (JSON) ของแต่ละขั้น เรียงตามลำดับ
├── bsc/                   📋 ก้อปไปวางใน Remix (https://remix.ethereum.org) แล้วดีพลอยบน BSC (ไฟล์เดิมใช้กับเชน EVM อื่นได้)
│   ├── BwscCoinBsc.sol    BEP-20 ของเหรียญ BWSC บน BSC
│   ├── BwscBridgeEvm.sol  bridge ฝั่งเชน EVM (logic) รองรับ token และเหรียญหลักของเชนนั้น (BNB)
│   └── BaseProxyUsed.sol  proxy ที่ครอบ bridge
└── engine/ project/ settings/ generated/   🧪 โค้ดชั่วคราว: เชนจำลอง, เทส, แผงทดสอบ (ไม่ต้องใช้ตอนดีพลอยจริง)
```

- ไฟล์ใน `bwsc/` และ `bsc/` เป็นโค้ดชุดเดียวกับที่เทสผ่านแล้ว ก้อปทั้งไฟล์ และอย่าแก้โค้ด
- ไฟล์ `bwsc/*.js` ขึ้นต้นด้วย `function program() {` ตรง ๆ เพราะ node ไม่รับอะไรก่อนบรรทัดนั้น คำอธิบายของแต่ละโปรแกรมจึงอยู่ข้างในฟังก์ชัน

## เหรียญในระบบ (4 ตัว + เหรียญหลักของเชน)

| เหรียญ | อยู่ที่ | มาจาก |
| --- | --- | --- |
| **BWSC** | BWSC (เหรียญหลักของเชน, address `0x0…0` ในทุกโปรแกรม) | เชนเอง |
| **wBWSC** | BWSC | ขั้น 2 (`WBWSC.js`) ฝาก BWSC ได้ wBWSC 1 : 1 ใช้เป็นฝั่ง BWSC ใน pool swap |
| **USDT (BWSC)** | BWSC | ขั้น 1 (`Token.js`) supply ทั้งหมดเข้า bridge เป็นสภาพคล่อง |
| **USDT (BSC)** | BSC | มีอยู่แล้ว: BSC-USD `0x55d398326f99059fF775485246999027B3197955` |
| **BWSC (BSC)** | BSC | ขั้น 5 (`BwscCoinBsc.sol`) supply ทั้งหมดเข้า bridge ฝั่ง BSC |

คนไม่ต้องรู้เรื่อง wBWSC ก็ใช้ได้: หน้า Swap สวาปด้วย BWSC ได้ตรง ๆ (โปรแกรม wrap / unwrap ให้เอง) และมีปุ่ม wrap / unwrap 1 : 1 ให้
ส่วน bridge กับ stake ใช้ BWSC ตัวจริง (native)

---

## ลำดับการดีพลอย

| ขั้น | ที่ไหน | อะไร | ใช้แอดเดรสจากขั้น | แอดเดรสที่ได้ → ใส่ใน `settings/config.js` |
| --- | --- | --- | --- | --- |
| 0 | — | สร้างกระเป๋า **signer** ใหม่ (ใช้กับ bridge) | | ใช้ในขั้น 7, 8 · private key ใส่แค่ `bridge-signer/.env` |
| 1 | BWSC explorer | USDT บน BWSC (`Token.js` + `inputs/1-USDT.json`) | | `tokens` (USDT, chain bwsc) · ใช้ในขั้น 7, 8 |
| 2 | BWSC explorer | wBWSC (`WBWSC.js` + `inputs/2-wBWSC.json`) | | `tokens` (wBWSC) · ใช้ในขั้น 3 |
| 3 | BWSC explorer | BwscDex (`inputs/3-BwscDex.json`) | 2 | `programs.dex` |
| 4 | BWSC explorer | BwscStaking (`inputs/4-BwscStaking.json`) | | `programs.staking` |
| 4b | BWSC explorer | BwscLimit: limit orders (`inputs/4b-BwscLimit.json`) | 1, 2 | `programs.limit` |
| 5 | Remix → BSC | BwscCoinBsc | | `tokens` (BWSC, chain bsc) · ใช้ในขั้น 7, 8 |
| 6 | Remix → BSC | BwscBridgeEvm (logic) | | ใช้ในขั้น 7 |
| 7 | Remix → BSC | BaseProxyUsed (proxy ของ bridge) | 0, 1, 5, 6 | `chains[bsc].bridge` |
| 8 | BWSC explorer | BwscBridge (`inputs/8-BwscBridge.json`) | 0, 1, 5 | `programs.bridge` |
| 9 | เว็บ / explorer / Remix | คู่ swap + สภาพคล่องแรก, pool stake + รางวัล, สภาพคล่อง bridge | ทั้งหมด | |
| 10 | เซิร์ฟเวอร์ของคุณ | รัน `bridge-signer/` | 7, 8 | `bridgeSigner.url` |

ไม่ต้องทำทุกขั้นพร้อมกัน
- ทำแค่ 1–4 ก็เปิด Swap กับ Stake ได้ (+ 4b = Limit orders)
- หน้า Bridge จะขึ้นว่ายังไม่ได้ตั้งค่า จนกว่าจะทำขั้น 5–10

## ขั้น 0 · กระเป๋า signer ของ bridge

สร้างกระเป๋าใหม่ 1 ใบ (เช่น MetaMask → Add account) ใช้**เซ็นยอดเคลมอย่างเดียว** กระเป๋านี้ไม่ต้องมีเงิน
- **แอดเดรส** ใส่ใน initialize ของขั้น 7 และใน input ของขั้น 8
- **private key** ใส่ใน `bridge-signer/.env` บนเซิร์ฟเวอร์ของคุณที่เดียว ใครได้ key นี้ไปจะเซ็นยอดเท่าไหร่ก็ได้
- **กระเป๋า relayer** (แนะนำให้สร้างอีก 1 ใบ แยกจาก signer และ owner): ส่งเหรียญให้ผู้ใช้อัตโนมัติและจ่ายค่า gas · ใส่ key ใน `RELAYER_PRIVATE_KEY` แล้วเติม BWSC บน BWSC และ BNB บน BSC (ดูยอดที่ `/status`)

## ขั้น 1–4, 4b และ 8 · ดีพลอยโปรแกรมบน BWSC ด้วย explorer

ทำแบบเดียวกันทุกตัว:

1. เปิด https://syncblock.network → **Deploy** (หรือ New program) แล้วเชื่อมกระเป๋า
   - ใช้ MetaMask บนเชน Bluewolfchain (chain id 41234)
   - กระเป๋าต้องมี BWSC พอจ่ายค่า gas
2. **Code**: เปิดไฟล์ใน `bwsc/` เลือกทั้งหมด ก้อป แล้ววาง
3. **Init input (JSON)**: ก้อปไฟล์จาก `bwsc/inputs/` มาวาง แล้วแทนที่ช่อง `<...>` ด้วยแอดเดรสจริง
4. **Attached value**: `0`
5. **Upgrader**:
   - USDT (ขั้น 1) และ wBWSC (ขั้น 2): **เว้นว่าง** โค้ดเหรียญจะเปลี่ยนไม่ได้ตลอดไป คนถือเหรียญไว้ใจได้
   - BwscDex, BwscStaking, BwscLimit, BwscBridge: กด **Use my wallet as upgrader** อัปเกรดโค้ดภายหลังได้ แต่ admin ต้องอนุมัติทุกครั้ง
6. กด **Deploy** แล้วเซ็น จะได้แอดเดรสโปรแกรมพร้อมสถานะ "awaiting approval"
7. **อนุมัติ (คุณเป็น admin):** เปิดหน้าโปรแกรมใน explorer → **Approve** (init) → เซ็น
   - ตอนนี้ `initialization` จะรันกับ input ที่ให้ไว้
   - ถ้า input ผิด (เช่นลืมแทน `<...>`) ขั้นนี้จะล้ม ให้ reject แล้วดีพลอยใหม่
8. ก้อปแอดเดรสเก็บไว้

| ขั้น | Code | Init input | แทนที่ |
| --- | --- | --- | --- |
| 1 | `Token.js` | `inputs/1-USDT.json` | ไม่มี |
| 2 | `WBWSC.js` | `inputs/2-wBWSC.json` | ไม่มี |
| 3 | `BwscDex.js` | `inputs/3-BwscDex.json` | `<YOUR_WALLET>`, `<wBWSC_ADDRESS>` (ขั้น 2) |
| 4 | `BwscStaking.js` | `inputs/4-BwscStaking.json` | `<YOUR_WALLET>` |
| 4b | `BwscLimit.js` | `inputs/4b-BwscLimit.json` | `<YOUR_WALLET>`, `<USDT_ON_BWSC_ADDRESS>` (ขั้น 1), `<wBWSC_ADDRESS>` (ขั้น 2) |
| 8 | `BwscBridge.js` | `inputs/8-BwscBridge.json` | `<YOUR_WALLET>`, `<SIGNER_ADDRESS>` (ขั้น 0), `<BWSC_ON_BSC_ADDRESS>` (ขั้น 5), `<USDT_ON_BWSC_ADDRESS>` (ขั้น 1) |

**ตัวเลขใน input**
- เขียนเป็นข้อความลงท้าย `n` (BigInt ของเชน) เช่น `"30n"`, `"1000000000000000000n"` ตัวเลขยาวต้องเขียนแบบนี้ เพราะ JSON เก็บเลขเกิน 2⁵³ ไม่ได้
- จำนวนเงินเป็นหน่วยเล็กที่สุด: เหรียญ 18 ทศนิยม 1 เหรียญ = `1` ตามด้วย 0 อีก 18 ตัว

**ใครได้อะไรตอนดีพลอย**
- `<YOUR_WALLET>` คือ owner: กระเป๋าที่ pause ได้, ตั้งค่าธรรมเนียมได้, เพิ่มคู่ / pool / เส้นทาง bridge ได้ ควรใช้กระเป๋าที่ปลอดภัยที่สุดของคุณ
- USDT จาก `Token.js`: supply ทั้งหมดเข้า**กระเป๋าที่กด Deploy**

**ค่าที่ปรับได้ (แก้ใน JSON ก่อนดีพลอย)**

| ไฟล์ | ช่อง | ความหมาย |
| --- | --- | --- |
| `1-USDT.json` | `supply`, `decimals` | จำนวนทั้งหมด (หน่วยเล็กสุด) · ทศนิยม**ต้องเป็น 18** ให้เท่ากับ BSC-USD (ผู้เซ็นไม่ยอมเซ็นเส้นทางที่ทศนิยมสองฝั่งต่างกัน) |
| `3-BwscDex.json` | `defaultFeeBps` | ค่าธรรมเนียมของคู่ใหม่ หน่วย 0.01% (`30n` = 0.30%, สูงสุด `100n`) ตั้งรายคู่ทีหลังได้ |
| `3-BwscDex.json` | `openPairs` | `false` = owner คนเดียวเพิ่มคู่ได้ · `true` = ใครก็เพิ่มได้ (แบบ DEX ทั่วไป ค่าธรรมเนียมเป็นค่า default) เปลี่ยนทีหลังได้ |
| `4b-BwscLimit.json` | `coins[]` | เหรียญที่อนุญาตให้ตั้ง limit order ตอนเริ่ม และค่าธรรมเนียมของแต่ละเหรียญ (`10n` = 0.10% ของที่คนซื้อได้รับ, สูงสุด `500n`) · เพิ่ม/ปิด/เปลี่ยนค่าธรรมเนียมทีหลังได้ที่หน้า Limit → แท็บ Owner |
| `8-BwscBridge.json` | `routes[].feeBps`, `min` | ค่าธรรมเนียม bridge ต่อเส้นทาง (`10n` = 0.10%, สูงสุด `500n`) และยอดโอนขั้นต่ำ |
| ทุกไฟล์ | `namespace` (เพิ่มเองได้) | ชื่อจำง่ายบนเชน ต้องไม่ซ้ำทั้งเชน |

## ขั้น 5–7 · ดีพลอยฝั่ง BSC ด้วย Remix

แนะนำให้ลองบน **BSC Testnet (chain id 97)** ก่อน แล้วค่อยทำซ้ำบน BSC จริง (56) ดูหมายเหตุ testnet ท้ายหัวข้อนี้

**ตั้ง Remix (ครั้งเดียว)**
1. เปิด https://remix.ethereum.org สร้างไฟล์ 3 ไฟล์ชื่อเดียวกับใน `bsc/` แล้ววางโค้ดแต่ละไฟล์ทั้งไฟล์
2. แท็บ **Solidity compiler**
   - Compiler `0.8.37`
   - Advanced configurations: **Enable optimization = 200**, **EVM version = paris**
   - Compile ทั้ง 3 ไฟล์
3. แท็บ **Deploy & run transactions**: Environment = **Injected Provider - MetaMask** (MetaMask อยู่บน BSC และมี BNB สำหรับ gas)

**ขั้น 5 · BwscCoinBsc** (BWSC บน BSC, supply คงที่ ไม่มีใคร mint เพิ่มได้)

Contract: `BwscCoinBsc` → ใส่ค่า constructor แล้วกด Deploy

| ช่อง | ค่า |
| --- | --- |
| `name_` | `Bluewolfchain` |
| `symbol_` | `BWSC` |
| `supply_` | จำนวนทั้งหมดในหน่วยเล็กสุด เช่น 100 ล้านเหรียญ = `100000000000000000000000000` |
| `holder_` | กระเป๋าของคุณ (supply ทั้งหมดเข้าที่นี่ แล้วจะเติมเข้า bridge ในขั้น 9) |

**ขั้น 6 · BwscBridgeEvm (logic)**
- Contract: `BwscBridgeEvm` → Deploy (ไม่มีค่า constructor)
- ตัว logic ถูกล็อกไว้ initialize ไม่ได้ ใช้งานผ่าน proxy เท่านั้น

**ขั้น 7 · ทำ calldata ของ initialize แล้วดีพลอย proxy**

1. ใน Deployed Contracts ของ logic (ขั้น 6) กดลูกศรเปิด `initialize` แล้วกรอก:

   | ช่อง | ค่า | หมายเหตุ |
   | --- | --- | --- |
   | `owner_` | กระเป๋าของคุณ | |
   | `signer_` | แอดเดรส signer (ขั้น 0) | |
   | `remoteChainId_` | `41234` | chain id ของ BWSC |
   | `tokens_` | `["<BwscCoinBsc ขั้น 5>","0x55d398326f99059fF775485246999027B3197955"]` | เหรียญบน BSC (ตัวหลังคือ BSC-USD) |
   | `remoteTokens_` | `["0x0000000000000000000000000000000000000000","<USDT บน BWSC ขั้น 1>"]` | ตัวคู่บน BWSC (0x000…0 = BWSC native) |
   | `feeBps_` | `[10,10]` | 0.10% ทั้งสองเหรียญ |
   | `mins_` | `["1000000000000000000","5000000000000000000"]` | ขั้นต่ำ 1 BWSC และ 5 USDT |

2. **อย่ากด transact** ให้กดปุ่ม **คัดลอก calldata** แทน
   - คือไอคอนก้อปข้างปุ่ม transact ("Encode values of input fields & copy to clipboard")
   - จะได้ข้อความขึ้นต้น `0x…`
3. Contract: `BaseProxyUsed` → ใส่ค่า constructor แล้วกด Deploy
   - `_impl`: แอดเดรส logic (ขั้น 6)
   - `_data`: calldata ที่ก้อปมา

   initialize รันตอนสร้าง proxy ในธุรกรรมเดียวกันเลย จึงไม่มีช่องให้ใครแทรก
4. **แอดเดรส proxy นี้คือ bridge ฝั่ง BSC** ใช้แอดเดรสนี้ทุกที่ ไม่ใช่แอดเดรส logic
5. สั่งฟังก์ชันของ bridge ใน Remix: เลือก Contract `BwscBridgeEvm` → ใส่แอดเดรส proxy ในช่อง **At Address** → กด At Address
6. ตรวจว่า `owner()`, `signer()`, `remoteChainId()`, `tokenList()` ตรงกับที่กรอก
7. กระเป๋าที่ดีพลอย proxy เป็น **admin ของ proxy** (อัปเกรด logic ได้ด้วย `upgradeTo`) ต้องเก็บกระเป๋านี้ให้ดีเท่ากับ owner

**Verify บน BscScan** (ไม่บังคับ แต่ควรทำ ให้คนอื่นอ่านโค้ดได้)
- Verify & Publish → Solidity (Single file) → compiler 0.8.37, optimization Yes 200, EVM paris → วางไฟล์ `.sol` ตัวนั้น
- proxy: ใส่ constructor arguments (แอดเดรส logic + calldata) แล้วกด "Is this a proxy?" ให้ BscScan ผูกกับ logic

**BSC Testnet (97)**
- testnet ไม่มี BSC-USD ให้ดีพลอย `BwscCoinBsc` อีกตัวเป็น USDT ทดสอบ (`name_` = `Test USDT`, `symbol_` = `USDT`)
- ใช้แอดเดรสนั้นแทน `0x55d3…7955` ทั้งใน `tokens_` (ขั้น 7) และใน `remoteToken` ของ USDT ใน `inputs/8-BwscBridge.json`
- ใน `inputs/8-BwscBridge.json` เปลี่ยน `"56n"` เป็น `"97n"`
- ใน `settings/config.js` ตั้ง `chains[bsc]` เป็น chainId 97 พร้อม RPC และ explorer ของ testnet

## ขั้น 9 · หลังดีพลอย

ใส่แอดเดรสใน `settings/config.js` ก่อน (หัวข้อสุดท้าย) แล้วเปิดเว็บด้วยกระเป๋า owner ส่วนใหญ่ทำจากเว็บได้เลย

**Swap: คู่แรกและสภาพคล่องแรก**
1. หน้า **Pool** → การ์ด **New pair** → เลือก BWSC กับ USDT → Create pair
   - เลือก BWSC ได้ตรง ๆ: pool เก็บเป็น wBWSC ให้เอง
   - วางแอดเดรส token อื่นในช่องค้นหาได้ (ใช้กับ token ใหม่ในอนาคต)
2. เปิดคู่ในรายการ → **Add liquidity** → ใส่ทั้งสองฝั่ง
   - สัดส่วนครั้งแรกคือราคาเริ่มต้น เช่น 100,000 BWSC + 85,000 USDT = 1 BWSC ≈ 0.85 USDT
3. ใน explorer ใช้ `createPair` (`{ "tokenA": "0x0000000000000000000000000000000000000000", "tokenB": "<USDT>" }`) และ `addLiquidity` ได้เหมือนกัน

**Staking**
1. **เฟส 1 สร้าง pool:** หน้า **Stake** → **New pool (owner)** → ตั้งชื่อ (a-z, 0-9, `-`) → เลือกเหรียญที่ฝาก → เลือกเหรียญรางวัล
   - ผสมแบบไหนก็ได้ เช่น `bwsc-usdt` (ฝาก BWSC รับ USDT), `usdt-usdt`, `usdt-bwsc` (ฝาก USDT รับ BWSC)
2. **เฟส 2 เติมรางวัล:** ปุ่ม **Add reward** บนการ์ด pool → ใส่จำนวนและจำนวนวัน
   - เติมได้ทุกเมื่อ กี่ครั้งก็ได้
   - รางวัลที่เติมแล้วถอนออกไม่ได้

**Limit orders: เหรียญที่อนุญาต**
- หน้า **Limit** → แท็บ **Owner** (เห็นเฉพาะกระเป๋า owner) → ใส่แอดเดรส token + ค่าธรรมเนียม → **Add coin**
- ปิดเหรียญชั่วคราว / เปลี่ยนค่าธรรมเนียม / ถอนค่าธรรมเนียมที่เก็บได้ ทำในแท็บเดียวกัน
- ปิดเหรียญแล้ว: ตั้งออเดอร์ใหม่และซื้อไม่ได้ แต่คนตั้งออเดอร์ยกเลิกเอาเหรียญคืนได้เสมอ

**Bridge: เติมเหรียญรอจ่าย (liquidity) ทั้งสองฝั่ง**

ระบบเป็นแบบล็อกและปล่อย ปลายทางต้องมีเหรียญพอจ่าย ถ้าไม่พอ คนเคลมรอได้และยอดไม่หาย

- **BWSC, USDT:** ที่โปรแกรม USDT สั่ง `approve` (`{ "spender": "<BwscBridge>", "amount": "…n" }`) แล้วที่ BwscBridge สั่ง `addLiquidity` (`{ "token": "<USDT>", "amount": "…n" }`)
  - โดยทั่วไปเติมทั้ง supply: USDT บน BWSC จะออกได้เฉพาะเมื่อมี USDT จริงถูกล็อกที่ BSC
- **BWSC, เหรียญ native:** ที่ BwscBridge สั่ง `addLiquidity` (`{ "token": "0x0000000000000000000000000000000000000000", "amount": "…n" }`) พร้อมใส่ **Attached value**
  - Attached value ต้องเป็นจำนวนเดียวกันแต่หน่วยเป็นเหรียญเต็ม (ช่องนี้ของ explorer ใช้หน่วยเหรียญ) เช่น amount `"100000000000000000000n"` → Attached value `100`
- **BSC:** ใน Remix ที่ `BwscCoinBsc` สั่ง `approve(<proxy ขั้น 7>, amount)` แล้วที่ bridge (At Address proxy) สั่ง `addLiquidity(<BwscCoinBsc>, amount)`
  - โดยทั่วไปเติมทั้ง supply
  - BSC-USD ไม่ต้องเติมตอนเริ่ม เพราะมาจากคนที่ bridge เข้า

**เพิ่มเส้นทาง bridge ทีหลัง** (เหรียญใหม่หรือเชนใหม่) ต้องตั้งให้ตรงกันทั้งสองฝั่ง ไม่งั้นผู้เซ็นไม่ยอมเซ็น
- ที่ BwscBridge: `setRoute` (`{ "chainId": "56n", "token": "<บน BWSC>", "remoteToken": "<บนเชนนั้น>", "enabled": true, "feeBps": "10n", "min": "…n" }`)
- ที่ bridge ของเชนนั้น: `setRoute(<บนเชนนั้น>, <บน BWSC>, true, fee, min)`
- เหรียญหลักของเชนใช้ `0x0…0` ได้ทั้งสองฝั่ง (เช่น BNB ↔ wBNB บน BWSC)
- **เชนใหม่ (เชน EVM ไหนก็ได้ เช่น Ethereum, Polygon, Arbitrum, Base):** ไม่ต้องแก้โค้ดเลย ทำตามนี้
  1. ดีพลอย `BwscBridgeEvm` + proxy บนเชนนั้นแบบขั้น 6–7 (สัญญาตัวเดียวกับ BSC) `remoteChainId_` = chain id ของ BWSC, `signer_` = กระเป๋า signer ตัวเดิม
  2. ที่ BwscBridge บน BWSC: `setRoute` ทีละเหรียญ ใส่ `chainId` ของเชนใหม่ (เช่น `"1n"` สำหรับ Ethereum)
  3. เติมสภาพคล่องฝั่งเชนใหม่ (`addLiquidity`) สำหรับเหรียญที่ต้องจ่ายออกที่นั่น
  4. `settings/config.js` → เพิ่ม 1 รายการใน `chains` (`key`, `short`, `name`, `chainId`, `rpcUrl`, `explorerUrl`, `native`, `bridge` = proxy, `confirmations`) และเพิ่มเหรียญของเชนนั้นใน `tokens` (`chain: "<key>"`)
  5. รีสตาร์ต bridge-signer (อ่าน `chains` จากไฟล์เดียวกัน) แล้ว build เว็บใหม่
  - หน้า Bridge จะขึ้นเชนใหม่ในตัวเลือก From / To และในรายการ "Chains and coins" เอง กระเป๋า (Reown) ก็รู้จักเชนนั้นเอง
  - เชนอื่นสองเชนไม่ได้บริดตรงหากัน ทุกเชนผ่าน BWSC (hub) หน้าเว็บบอกผู้ใช้ให้บริดเข้า BWSC ก่อนแล้วค่อยออก
  - ถ้าเชนไหนอ่านไม่ได้หรือช้า (เกิน 10 วินาที) หน้าเว็บขึ้นว่าเชนนั้น "Not available" เชนอื่นยังใช้ได้ปกติ

## อัปเกรด BwscDex ที่ดีพลอยไปแล้วเป็น v2 (ไม่ต้องดีพลอยใหม่)

ถ้าดีพลอย BwscDex ไปแล้ว (ตอนดีพลอยกด **Use my wallet as upgrader**) อัปเกรดเป็น v2 ได้เลย แอดเดรสเดิม คู่เดิม สภาพคล่องเดิมอยู่ครบ
1. explorer → หน้าโปรแกรม BwscDex → **Upgrade** (ใช้กระเป๋า upgrader)
2. **Code:** วาง `bwsc/BwscDex.js` ตัวใหม่ทั้งไฟล์ · **Migrate input:** `{}`
3. เซ็น แล้ว **Approve** การอัปเกรด (คุณเป็น admin) ตอนนี้ `migrate()` จะรันครั้งเดียว: นับยอด token ของทุกคู่ (ใช้กับ `skim`)
4. เช็ก: `getView` ต้องได้ `version: 2n` และ `blockTime` เป็นเวลาปัจจุบัน (วินาที)

เทส `BwscDexV2.test.mjs` ทำขั้นตอนนี้จริงบน node: ดีพลอย v1 → สร้างคู่ + สภาพคล่อง + สวาป → อัปเกรด → ยอด reserve, ส่วนแบ่ง และฟังก์ชันใหม่ใช้ได้ครบ

**ใน v2 มีอะไรเพิ่ม (ทุกตัวใช้ใน explorer ได้ด้วย)**
- `deadline` (unix วินาที) ใน `swap` / `swapExactOut` / `addLiquidity` / `removeLiquidity`: เลยเวลาแล้วโปรแกรมไม่รับ ("Expired") กันธุรกรรมที่ค้างในคิวนานไปสวาปที่ราคาเก่า · ไม่ใส่หรือใส่ `0n` = ไม่มี deadline
- `to`: ส่งผลลัพธ์ให้แอดเดรสอื่น
- `swapExactOut(path, amountOut, maxIn)`: ได้เท่านี้แน่นอน จ่ายไม่เกินเท่านี้ · `quoteIn(path, amountOut)` ดูยอดที่ต้องจ่าย
- `transferShares`, `approveShares`, `transferSharesFrom`: ย้ายตำแหน่ง LP ให้คนอื่นหรือให้โปรแกรมอื่น (เช่น farm ในอนาคต)
- ราคาเฉลี่ยตามเวลา (`priceACumulative`, `priceBCumulative`, `cumulativeAt` ใน `getPair`) ให้โปรแกรมอื่นใช้ราคาที่ block เดียวปั่นไม่ได้
- `skim(token, to)` (owner): คืน token ที่มีคนโอนเข้าโปรแกรมผิด เฉพาะส่วนที่เกิน reserve ของทุกคู่ แตะเงินใน pool ไม่ได้

## ขั้น 10 · bridge-signer

ดู `bridge-signer/README.md`
- ใส่ `SIGNER_PRIVATE_KEY` (ขั้น 0) ใน `bridge-signer/.env`
- ค่าอื่นทั้งหมดอ่านจาก `settings/config.js` ไฟล์เดียวกับเว็บ
- ตอนเริ่ม signer เช็กว่าแอดเดรสของ key ตรงกับ signer ของ bridge ทุกเชน

## สุดท้าย · ใส่แอดเดรสในแอป

แก้ `settings/config.js` ไฟล์เดียว (commit ได้ ไม่มีความลับ):

```js
programs: { dex: "<ขั้น 3>", staking: "<ขั้น 4>", limit: "<ขั้น 4b>", bridge: "<ขั้น 8>" },
chains: [ { key: "bsc", ..., bridge: "<proxy ขั้น 7>" } ],
bridgeSigner: { url: "https://<เซิร์ฟเวอร์ signer>" },
tokens: [
    { chain: "bwsc", address: "<ขั้น 1>", symbol: "USDT", ... },
    { chain: "bwsc", address: "<ขั้น 2>", symbol: "wBWSC", ..., wraps: "native" },
    { chain: "bsc", address: "0x55d3…7955", symbol: "USDT", ... },
    { chain: "bsc", address: "<ขั้น 5>", symbol: "BWSC", ... },
],
```

และใส่ Reown Project ID (https://dashboard.reown.com) ด้วย:

```js
wallet: { reownProjectId: "<32 ตัวอักษร>" },   // + เพิ่มโดเมนเว็บใน allowed domains ของ project ใน dashboard
prices: { unit: "USDT" },                       // ราคาทุกอย่างอ่านจาก pool (ไม่มีราคาให้พิมพ์เอง)
```

แล้วรัน `npm install` (ครั้งแรก ติดตั้ง Reown) → `npm run build`
- ช่องที่ยังว่าง: หน้านั้นบอกว่ายังไม่ได้ตั้งค่า ส่วนอื่นใช้ได้ปกติ
- แอดเดรสผิดรูปแบบ: เว็บขึ้น "Setup is not finished" และบอกช่องที่ผิด

### ช่องจดแอดเดรส

| ขั้น | อะไร | แอดเดรส |
| --- | --- | --- |
| 0 | signer | |
| 1 | USDT (BWSC) | |
| 2 | wBWSC | |
| 3 | BwscDex | |
| 4 | BwscStaking | |
| 4b | BwscLimit | |
| 5 | BwscCoinBsc = BWSC (BSC) | |
| 6 | BwscBridgeEvm logic (BSC) | |
| 7 | **proxy = bridge ฝั่ง BSC** | |
| 8 | BwscBridge | |

---

## ⚠ ก่อนเปิดให้คนอื่นใช้

- **USDT บน BWSC มีค่าเท่า USDT จริงก็ต่อเมื่อทุกเหรียญที่หมุนอยู่มี BSC-USD ล็อกใน bridge ฝั่ง BSC รองรับ**
  - อย่าแจก USDT บน BWSC จาก supply ตรง ๆ ให้ออกผ่าน bridge เท่านั้น
  - สภาพคล่องแรกของคู่ swap และรางวัล stake ที่เป็น USDT ก็ควรมาจาก USDT ที่ bridge เข้ามา
- **อำนาจของ owner และ admin**
  - owner ของ bridge ถอนสภาพคล่องได้
  - owner ของ BwscDex เปลี่ยนค่าธรรมเนียม (ไม่เกิน 1%) และ pause ได้ แต่ไม่มีทางแตะเงินใน pool
  - admin ของ proxy ฝั่ง BSC อัปเกรด logic ได้
  - ควรใช้กระเป๋าที่ปลอดภัย (hardware wallet / multisig)
- **ถ้าสงสัยว่า key ของ signer หลุด:** `setPaused(true)` ทุกฝั่งทันที → `setSigner(ใหม่)` ทุกฝั่ง → แล้วค่อยเปิดใหม่
- **กฎหมาย:** การรับและส่งเงินจริงข้ามเชนอาจต้องมีใบอนุญาตตามกฎหมายของแต่ละประเทศ ตรวจก่อนเปิดใช้จริง

---

## 🧪 โค้ดชั่วคราว: เทสกับเชนจำลอง (ไม่บังคับ)

ใช้ตอนแก้โปรแกรมหรือหน้าเว็บ แล้วอยากลองก่อนดีพลอยจริง
- ทุกอย่างรันบนเชนจำลองในเครื่อง ปิดแล้วหายหมด
- ไม่แตะเชนจริง และไม่แตะ `settings/config.js` (ค่าของเชนจำลองส่งให้เว็บแยกต่างหาก)

```bash
cd deploy-kit
npm install                      # ethers, playwright, solc, programvm (node จริงของเชน)
npm run dev                      # เชนจำลอง + ดีพลอยทุกอย่าง + คู่ swap / pool stake / ข้อมูลตัวอย่าง + เว็บพร้อมแผงทดสอบ
npm test                         # เทสโปรแกรมทุกตัว (รวมเทสว่าไฟล์ใน bwsc/inputs ดีพลอยได้จริงตามคู่มือนี้)
npm run test:app                 # เทสทั้งแอปในเบราว์เซอร์
```

| คำสั่ง (flag อยู่หลัง `--`) | ทำอะไร |
| --- | --- |
| `npm run compile` | ตรวจไฟล์ใน `bwsc/` ด้วยกฎของ node (autoreview + ดีพลอยลอง) บอกขนาดที่เหลือจาก 64 KB |
| `npm run compile:bsc` | คอมไพล์ `bsc/*.sol` ด้วย solc 0.8.37 แล้วเช็กว่า ABI ในเว็บ (`src/project/chain/abi/`) ยังตรงกับสัญญา |
| `npm run dev` / `dev:mock` | เชนจำลองจริง / mock node (ไม่ต้องติดตั้งเชน) + เว็บ + แผงทดสอบ |
| `npm test` / `test:mock` | เทสโปรแกรมใน `project/test/` (เลือกไฟล์ด้วย `-- --only Inputs`) |
| `npm run test:app` / `test:app:real` | เทสแอปใน `project/app-test/` บน mock / node จริง |

- bridge ในเชนจำลองต้องมี [Foundry](https://getfoundry.sh) (`anvil`) ถ้าไม่มี หน้า Bridge จะบอกว่ายังไม่ได้ตั้งค่า ที่เหลือใช้ได้ปกติ
- เว็บบนเชนจำลองใช้หน้าต่างกระเป๋าของ bwscbox + demo wallet แทน Reown เพื่อให้เทสคุมกระเป๋าได้ (เว็บจริงใช้ Reown อย่างเดียว)
- กุญแจในเชนจำลองมาจาก mnemonic ทดสอบสาธารณะของ hardhat ห้ามใช้กับเงินจริง
- ค่าของเชนจำลองอยู่ใน `settings/` ของโฟลเดอร์นี้ (`programs/*.env`, `test-setup.json`, `local.env`) ไม่เกี่ยวกับเชนจริง
- แก้โปรแกรมใน `bwsc/` แล้ว: `npm run compile` → `npm test` → ก้อปไฟล์ใหม่ไปอัปเกรดใน explorer (upgrade → admin อนุมัติ)
