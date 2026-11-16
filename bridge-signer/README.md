# bridge-signer: ผู้เซ็นยอด + ผู้ส่งเหรียญอัตโนมัติของ Bridge (BWSC ↔ เชน EVM)

บริการเล็ก ๆ ที่อ่าน**ยอดสะสม**บนเชนต้นทาง แล้วเซ็นยอดนั้นให้เชนปลายทาง (EIP-712 `BwscBridge` v2)
และ**ส่งเหรียญให้ผู้ใช้เอง** (relayer): ผู้ใช้กดบริดครั้งเดียว เหรียญเข้ากระเป๋าปลายทางเอง ไม่ต้องกดเคลม ไม่ต้องมีค่า gas ฝั่งปลายทาง

## ส่งอัตโนมัติ (relayer) ทำงานยังไง

1. **หาการโอน** ทุก 4 วินาที: อ่าน event `BridgeIn` ของทุกเชน EVM และ `BridgeOut` บน BWSC (หน้าเว็บก็แจ้งมาที่ `/deliver` ทันทีหลังโอน ทำให้เร็วขึ้น แต่ถ้าปิดเว็บไปก่อน relayer ก็เจอเอง)
2. **รอให้ปลอดภัย** ตาม `confirmations` ของเชนต้นทาง (ใช้ตัวเซ็นตัวเดิม ตรวจเหมือนเดิมทุกอย่าง)
3. **ส่ง claim ให้** บนเชนปลายทาง โดยกระเป๋า relayer จ่ายค่า gas เอง เงินเข้ากระเป๋าเจ้าของเสมอ (สัญญาจ่ายให้ account ในลายเซ็น ไม่ใช่คนส่ง) ส่งซ้ำก็ไม่จ่ายซ้ำ
4. **gas drop** (เลือกได้): กระเป๋าที่ไม่มีเหรียญหลักของเชนปลายทางเลย (เช่นกระเป๋าใหม่ที่บริด USDT เข้ามา) ได้เหรียญหลักเล็กน้อยครั้งเดียว ไว้จ่ายค่า gas ครั้งแรก

- จำว่าอ่านถึงไหนแล้วใน `relayer-state.json` (ปิดแล้วเปิดใหม่ทำต่อได้ ไม่ส่งซ้ำ)
- ถ้า relayer ล่ม เงินไม่หาย: ผู้ใช้กด "Claim now" เองในหน้าเว็บได้ หรือรอ relayer กลับมาแล้วส่งให้เอง
- เปิด/ปิดที่ `settings/config.js` → `bridgeSigner.autoDeliver` · จำนวน gas drop ที่ `bridgeSigner.gasDrop`

**กระเป๋า relayer ต้องมีเงินค่า gas ทุกเชน** (เช่น BWSC บน BWSC และ BNB บน BSC) ดูยอดคงเหลือที่ `GET /status` → `relayer.balances`
- ค่า gas ต่อครั้ง: BWSC ~0.09 BWSC · BSC ไม่กี่เซ็นต์ · gas drop ตามที่ตั้ง (ค่าตั้งต้น 0.5 BWSC ต่อกระเป๋าใหม่)
- ทุนคืนจากค่าธรรมเนียมบริด (`feeBps`): owner ถอนด้วย `withdrawFees` แล้วเติมให้กระเป๋า relayer
- ตั้ง `min` ของแต่ละเส้นทางให้สูงกว่ามูลค่า gas drop + ค่า gas หลายเท่า กันคนสร้างกระเป๋าใหม่มาเก็บ gas drop

| ทิศ | อ่านจาก | เซ็นให้ | relayer ส่ง (หรือผู้ใช้กดเองได้) |
| --- | --- | --- | --- |
| เชน EVM → BWSC | `BwscBridgeEvm.getBridgeView` บนเชนนั้น (ที่ block `finalized` หรือย้อนหลังตาม `confirmations` block) | `BwscBridge` บน BWSC | `claimIn` |
| BWSC → เชน EVM | `BwscBridge.bridgedOutOf(chainId, account, token)` | `BwscBridgeEvm` (proxy) บนเชนนั้น | `claimOut` |

- ปลายทางจ่าย `ยอดที่เซ็น − ยอดที่เคลมแล้ว` จึงเซ็นยอดเดิมหรือยอดใหม่ซ้ำได้เสมอ โดยไม่มีการจ่ายซ้ำ
- ลายเซ็นผูกกับ chain id ต้นทาง + chain id ปลายทาง + แอดเดรสของ bridge ปลายทาง

## ใช้งาน

```bash
cd bridge-signer
npm install
cp .env.example .env     # ใส่ SIGNER_PRIVATE_KEY (และ RELAYER_PRIVATE_KEY ถ้าแยกกระเป๋าจ่าย gas)
npm start                # GET /claim  /deliver  /pending?account=  /status
```

**รันบนเครื่องตัวเอง (localhost) คู่กับเว็บ `npm run dev`:** ใส่ `ALLOW_ORIGINS=http://localhost:5173` ใน `.env` และตั้ง `bridgeSigner.url: "http://localhost:8790"` ใน `settings/config.js` (ตอนขึ้นจริงเปลี่ยนกลับเป็น URL https ของเซิร์ฟเวอร์ และลบ `ALLOW_ORIGINS`)

**ค่าตั้ง**
- ทุกอย่างนอกจาก key อ่านจาก `../settings/config.js` ไฟล์เดียวกับเว็บ: node, `programs.bridge`, `chains[].bridge` / `rpcUrl` / `confirmations`, `app.siteUrl` (= CORS)
  - ก้อปไปรันบนเซิร์ฟเวอร์: เอา `bridge-signer/` กับ `settings/config.js` ไปด้วย หรือชี้ที่อื่นด้วย `CONFIG_FILE`
- `RELAYER_PRIVATE_KEY` (แนะนำ) กระเป๋าที่จ่ายค่า gas ให้ผู้ใช้ ใส่แค่เงินค่า gas พอ ถ้าหลุดเสียแค่เงินค่า gas เพราะส่ง claim ได้แค่ตามลายเซ็นของ signer · ไม่ใส่ = ใช้ key ของ signer จ่าย
- key คือกระเป๋า signer ของขั้น 0 ใน `deploy-kit/README.md`
  - แอดเดรสต้องตรงกับ `signer` ของ bridge ทุกเชน ตอนเริ่มจะเช็ก ไม่ตรงก็ไม่ยอมเริ่ม
  - ไม่รับ key ทดสอบสาธารณะ ("test test … junk") ยกเว้นเชนจำลองในเครื่อง

**ก่อนเซ็น ผู้เซ็นตรวจว่า**
- เส้นทางของเหรียญตั้งให้ชี้หากันทั้งสองฝั่ง
- ทศนิยมของเหรียญสองฝั่งเท่ากัน เพราะสะพานจ่าย 1:1

ถ้าไม่ผ่านจะไม่เซ็น · จำกัด 60 ครั้ง/นาที/IP

## ความปลอดภัย

- **ใครได้ `SIGNER_PRIVATE_KEY` ไป จะเซ็นยอดเท่าไหร่ก็ได้ และดึงเงินในสะพานได้หมด** เก็บไว้บนเซิร์ฟเวอร์ที่คุณคุมเท่านั้น
- ถ้าสงสัยว่า key หลุด: owner `setPaused(true)` ทุกฝั่งทันที → `setSigner(ใหม่)` ทุกฝั่ง → แล้วค่อยเปิดใหม่
- `confirmations: "finalized"` เป็นค่าแนะนำ (เชนส่วนใหญ่ เช่น BSC, Ethereum มี finalized block) หรือตั้งเป็นจำนวน block เพื่อกัน reorg สำหรับเชนที่ไม่มี
- เพิ่มเชนใหม่: เพิ่มใน `chains` ของ `settings/config.js` แล้วรีสตาร์ตบริการนี้ เซ็นให้ทุกเชนด้วย key เดียว
- ถ้ารันหลัง reverse proxy ให้ตั้ง `TRUST_PROXY=true` ไม่งั้นทุกคนใช้โควตา 60 ครั้ง/นาทีร่วมกัน
- ถ้าอยากลดความเสี่ยงภายหลัง: เปลี่ยนเป็นหลายผู้เซ็น (m-of-n) ได้ด้วยการอัปเกรดทั้งสองฝั่ง
