# URL Image Zipper

Static GitHub Pages tool for turning a CSV of image URLs into a ZIP.

Live app:

```text
https://fcast-automations.github.io/url-into-image-converter/
```

## Browser use

1. Open `index.html` from GitHub Pages.
2. Upload a `.csv` or text file containing image URLs.
3. Click `Download ZIP`.

Default mode is `Direct only - fastest`. If some links fail, try `Direct, then proxy` or `Proxy only`. GitHub Pages is static, so browser-blocked hosts need a proxy.

## Huge files

For 220k links, use the local Python script. It streams into the ZIP and does not need packages:

```powershell
python download_images.py links.csv -o images.zip -w 64
```

Use fewer workers if the network or source host starts failing:

```powershell
python download_images.py links.csv -o images.zip -w 24 --timeout 45
```
