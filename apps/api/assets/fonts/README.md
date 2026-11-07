# Fonts for PDF output

By The Noto Project Authors, licensed under the SIL Open Font License 1.1 (`OFL.txt`):

- `NotoSans-Regular.ttf`, `NotoSans-Bold.ttf`: static hinted, from [notofonts.github.io](https://github.com/notofonts/notofonts.github.io)
- `NotoSansTamil-Regular.ttf`, `NotoSansTamil-Bold.ttf`: static hinted, from the same place
- `NotoSansSinhala-Variable.ttf`: the variable font `NotoSansSinhala[wdth,wght].ttf` from [google/fonts](https://github.com/google/fonts/tree/main/ofl/notosanssinhala)

**Sinhala uses the variable font on purpose.** With the static Sinhala files, pdfmake's text engine (fontkit) leaves a gap after සු, so සුනිල් prints as "සු නිල්". The variable font shapes it correctly; its default instance is the regular weight, so Sinhala text is not printed in bold. See `docs/adr/0001-pdf-engine.md`.

The files are committed and loaded from disk so that PDFs render Sinhala and Tamil on a self-hosted install with no internet connection (NFR-04, NFR-11).
