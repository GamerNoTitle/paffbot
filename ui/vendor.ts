/**
 * Mini App 的组件入口：只注册实际用到的 Material Web 组件，
 * 由 scripts/build-ui.mjs 打成单文件 public/vendor/material.js。
 */
import "@material/web/button/filled-button.js";
import "@material/web/button/outlined-button.js";
import "@material/web/button/filled-tonal-button.js";
import "@material/web/button/text-button.js";
import "@material/web/iconbutton/icon-button.js";
import "@material/web/icon/icon.js";
import "@material/web/textfield/outlined-text-field.js";
import "@material/web/progress/linear-progress.js";
import "@material/web/progress/circular-progress.js";
import "@material/web/dialog/dialog.js";

import { styles as typescaleStyles } from "@material/web/typography/md-typescale-styles.js";

// MD3 字阶（display/headline/title/body/label）
if (!document.adoptedStyleSheets.includes(typescaleStyles.styleSheet as CSSStyleSheet)) {
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, typescaleStyles.styleSheet as CSSStyleSheet];
}

export { applyTheme, telegramSeed, DEFAULT_SEED } from "./theme.js";
