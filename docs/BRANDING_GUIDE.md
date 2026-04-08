# Customizing App Branding

You can customize the logo and branding of **expose.u Wrap Preview** by placing files in the `brand/` directory within your project folder.

### 1. Logo Customization

The app looks for logo files in the following order:

- **`brand/logo.svg`**: Recommended for the highest quality and scalability.
- **`brand/logo.png`**: (Planned) Fallback if SVG is missing.

#### How to replace

Simply place your `logo.svg` inside the `brand/` folder of your project. If you use the in-app Branding UI, it will automatically save it here for you.

### 2. Color Profile

The `brand/profile.json` file controls the UI theme and PDF colors:

```json
{
  "name": "Your Company Name",
  "colors": {
    "primary": "#ffffff",
    "primary_hover": "#e2e8f0",
    "accent": "#00f2ff",
    "background": "#08080a",
    "text": "#ffffff",
    "border": "#1c1c1f"
  }
}
```

### 3. Application Assets

- **Logo Area**: The logo in the header and PDF is rendered at a maximum height of 40px.
- **SVG requirements**: For best results, ensure your SVG is optimized and has a transparent background.
