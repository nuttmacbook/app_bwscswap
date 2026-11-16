# deploy-kit/settings/ ⚙️ ค่าของเชนจำลองเท่านั้น

ไม่เกี่ยวกับเชนจริง เชนจริงใช้ค่าจาก 3 ที่ (ดู `deploy-kit/README.md`):
- `deploy-kit/bwsc/inputs/*.json`
- ค่าที่คุณกรอกใน Remix
- `settings/config.js` ของเว็บ

| ไฟล์ | คืออะไร |
| --- | --- |
| `programs/<ชื่อ>.env` | ค่าที่โปรแกรมรับตอนดีพลอยบนเชนจำลอง (USDT, WBWSC, BwscDex, BwscStaking, BwscBridge) ทุก key ต้องมีค่า |
| `deploy.config.mjs` | ดีพลอยอะไร ลำดับไหน บนเชนจำลอง (`program()` / `token()`) และตรวจผลยังไง |
| `test-setup.json` | คู่ swap + สภาพคล่องแรก และ pool stake ที่เชนจำลองสร้างให้ (ฝาก BWSC รับ USDT, USDT→USDT, USDT→BWSC) |
| `test-tokens.json` | เหรียญที่มีบนเชนจริงแต่เชนจำลองไม่มี + ค่าที่ใช้แทน |
| `local.env` | port, chain id, block time, ข้อมูลตัวอย่าง, จำนวนที่ปุ่มในแผงทดสอบให้ |
| `bsc/` | ฝั่ง BSC ของเชนจำลอง (anvil): ค่าของ BwscBridgeEvm, BwscCoinBsc และเหรียญทดสอบ |
