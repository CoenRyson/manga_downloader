# Local Tesseract assets

These files keep OCR self-contained at runtime. The application does not load
OCR code, WebAssembly, or language data from a third-party CDN.

- `worker.min.js`: `tesseract.js` 7.0.0 (`Apache-2.0`)
- `core/*`: `tesseract.js-core` 7.0.0 (`Apache-2.0`)
- `lang/*.traineddata.gz`: `@tesseract.js-data/*` 1.0.0, path
  `4.0.0_best_int` (`MIT`, source: <https://github.com/naptha/tessdata>)

Pinned SHA-256 checksums:

```text
576B7DF7E3393E137E51849357C9ADB53FE7AC1BB69BFA06CF3D61520F182C6D  worker.min.js
EEF5F8B2F8E20E150680B20ADAEC4A60BABAFEE3ADBE8A94583C81FEE46E8680  core/tesseract-core-lstm.wasm.js
861A536CF9EF8E63CB644D57BAB39C388F37F7D6B6F60024B741C5F6B39A59B3  core/tesseract-core-relaxedsimd-lstm.wasm.js
C58B46A4C796C0B8AFCCF77591D5B875B6896B45D402BBCE8CAA6F5362447B38  core/tesseract-core-simd-lstm.wasm.js
1EA33A8B6F9A9C18A6AAE44A71EDA06BBFDC206FE53CF1FC8121FB74DEF99166  lang/ces.traineddata.gz
306C4280D0CBED46FBFF727486BD43B92730181BAE80F56941A091F363BDF28B  lang/deu.traineddata.gz
45B4CB346724AC1774F1C36F42F182B887BCDB28EBE63E6FFF90AC41F3FCFF91  lang/eng.traineddata.gz
2B63EBFBF1484DE4A08CE53B29EF98A1C17658A93CBD38ACB665D7D316D0BE88  lang/jpn.traineddata.gz
3A4F4DF8DF8F50F3389FE0DA10502EFFCED38FAEF763D8E540142BDC9B770308  lang/jpn_vert.traineddata.gz
A20FDEC4FF99D8F8E84C708DA3E42A4E935C26863055A0ED88AEF5C66A59B91B  lang/pol.traineddata.gz
```
