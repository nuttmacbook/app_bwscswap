# bwscbox

kitbox สำหรับเชน **BWSC (Program VM)** — ต่อกระเป๋า, เพิ่มเชนลงกระเป๋า, เซ็น tx แบบ EIP-712, เรียก/อ่านโปรแกรม JS
ไม่มี dependency (ESM ล้วน) ใช้ได้ทั้ง browser และ Node 18+

```js
import { bwscbox, utils } from "bwscbox";

const box = new bwscbox({ node: "https://node.example.com", appName: "My dApp" });
const modal = box.createModal("dark", { "--bwsc-accent": "#e9b949" });   // หน้าต่าง Connect / บัญชี

box.safeRenderApp(async (state) => {          // ตอนโหลด + ทุกครั้งที่บัญชี/เชนเปลี่ยน
    // state = { address, chainId, isRightChain, walletName, signer } | null
});
modal.open();

const Pool = { name: "BwscSwap", address: "0x…", functions: [ "swap", "getView" ] };

// อ่าน (POST /query ไม่ต้องมีกระเป๋า ไม่เสีย gas) — รูปแบบเดียวกับ web3 contract.methods.x().call()
const view = await box.createReader(Pool).methods.getView({ account: state.address }).call();

// เขียน: กระเป๋าเซ็น EIP-712 → node simulate ก่อนรับ (ล้ม = throw ทันที ไม่เสียอะไร) → wait() รอ block
const tx = await box.createProgram(Pool, state.signer).swap({ tokenIn, amountIn: 5n, minOut: 4n });
const receipt = await tx.wait();              // program throw → ChainError พร้อมข้อความของโปรแกรม

// token มาตรฐานของเชน
await (await box.createProgram(box.tokenAt(token), state.signer).approve({ spender: Pool.address, amount: 5n })).wait();
```

## เทียบกับ kitbox

| kitbox (BSC) | bwscbox (BWSC) |
| --- | --- |
| `new kitbox()` + `createModal(projectId, networks, theme, vars)` (Reown AppKit) | `new bwscbox({ node })` + `createModal(theme, vars)` — ไม่ต้องมี projectId |
| `safeRenderApp`, `getCurrentState`, `getCurrentRpc` | ชื่อเดียวกัน |
| `createWeb3Contract(C, rpc).methods.x().call()` | `createReader(P).methods.x(input).call()` |
| `createEtherContract(C, signer).x()` → `tx.wait()` | `createProgram(P, signer).x(input, { value })` → `tx.wait()` |
| `handleTxError(C, error)` | ชื่อเดียวกัน → `{ message, code, isUserReject }` (ข้อความ error ของ node เป็นอังกฤษให้แล้ว) |
| `utils.shortAddress / formNumber / timestampToUTC / delay` | เหมือนกัน + `toUnits`, `fromUnits`, `fromChainValue`, `toChainValue` |
| `chain.bsc` | เชนอ่านจาก node เอง (`GET /genesis`, `GET /evm`) |

## สิ่งที่ทำให้อัตโนมัติ

- หากระเป๋าแบบ **EIP-6963** (MetaMask, Rabby, OKX, Trust …) + `window.ethereum` สำรอง · จำกระเป๋าที่เลือก (localStorage) และต่อกลับเงียบ ๆ ตอนโหลด
- กระเป๋าอยู่ผิดเชน → `wallet_switchEthereumChain` · ไม่รู้จักเชน → `wallet_addEthereumChain` ด้วยค่าจาก `GET /evm` ของ node
- ก่อนเซ็นทุกครั้งสลับเชนให้ (MetaMask เซ็น typed data ได้เฉพาะ chainId ที่เปิดอยู่)
- tx: เติม chainId / nonce (รวมใบที่รอคิว) / ค่าแก๊ส EIP-1559 (2 × base fee) ให้เอง
- ตัวเลข BigInt ↔ `"123n"` ของเชนแปลงให้ทั้งขาไปและขากลับ
- POST เป็น `text/plain` → ไม่มี CORS preflight (node ตอบ preflight เฉพาะ `/evm`)
- มือถือที่ไม่มีกระเป๋า: ปุ่ม "Open in MetaMask app" (deep link)

## Node / สคริปต์ / เทส

```js
import { createClient, keyWalletSigner } from "bwscbox";
import { ethers } from "ethers";
const client = createClient({ node: "http://127.0.0.1:8645" });
const signer = keyWalletSigner(new ethers.Wallet(KEY));          // อะไรก็ได้ที่มี signTypedData
const sent = await client.send({ action: "deploy", code, input: {}, upgrader: OWNER }, signer);
const receipt = await client.waitReceipt(sent.hash);
```

## เทส

| คำสั่ง | ทดสอบอะไร | ต้องมี |
| --- | --- | --- |
| `npm test` | หน่วยย่อย 42 ข้อ: client (text/plain, BigInt, prepare/send/wait, nonce ไม่ชนเมื่อส่งพร้อมกัน, error เป็นอังกฤษ), program (proxy, reader, handleTxError), wallet manager (EIP-6963, เพิ่ม/สลับเชน, เซ็นด้วย key จริง, เปลี่ยนบัญชี/เชน, reload, กระเป๋าล็อก, disconnect), values | ไม่มี (กระเป๋าจำลองแบบ MetaMask + fetch จำลอง) |
| `npm run test:node` | กับ **node จริงของเชน** 19 ข้อ: deploy → admin init, อ่าน/เขียนโปรแกรม, program throw ไม่เสียเงิน, กระเป๋าไม่มีเหรียญ, caller ของ query, ส่ง 5 ใบพร้อมกัน, sponsor จ่ายแก๊สแทน, legacy gasPrice, CORS + typed data เทียบโค้ดเชน 252 แบบ | `BWSC_CHAIN_DIR=<repo เชน>` (ทำ `npm install` ใน repo เชนแล้ว) |
| `npm run test:browser` | **Chromium จริง** 10 ข้อ: หน้าต่าง Connect (ไม่มีกระเป๋า / มือถือ / กัน HTML แปลก ๆ), เชื่อม → เพิ่มเชน → ส่ง tx จริงจากหน้าเว็บ, สลับเชน, reload ต่อเอง, disconnect, ปิด prompt | `BWSC_CHAIN_DIR` + `npx playwright install chromium` (หรือ `PW_CHROMIUM=<path chrome>`) |
| `npm run test:all` | ทั้งหมด | ทั้งหมดด้านบน |

ไฟล์: `test/unit/`, `test/node/`, `test/browser/`, ตัวช่วยใน `test/helpers/` (`fakeWallet.mjs` = กระเป๋าแบบ MetaMask ที่เซ็นด้วย key จริง, `fakeFetch.mjs`, `chainNode.mjs` = เปิด node จริงแบบ in-memory บน port ว่าง)

`src/typedData.js` เป็นสำเนาของ `buildTypedData` ใน `src/crypto/signature.js` ของเชน — ถ้าแก้ฝั่งเชน ต้องแก้ที่นี่ด้วย (เทสด้านบนจะฟ้อง)
