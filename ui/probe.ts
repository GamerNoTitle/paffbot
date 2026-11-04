import "@material/web/button/filled-button.js";
import { argbFromHex, hexFromArgb, themeFromSourceColor } from "@material/material-color-utilities";
const theme = themeFromSourceColor(argbFromHex("#4F5BD5"));
console.log(hexFromArgb(theme.schemes.light.primary));
