import { copyFile, mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await mkdir("dist/assets", { recursive: true });
await mkdir("dist/assets/icons", { recursive: true });
await copyFile("manifest.json", "dist/manifest.json");
await copyFile("assets/icon.svg", "dist/assets/icon.svg");
await copyFile("assets/icons/icon-16.png", "dist/assets/icons/icon-16.png");
await copyFile("assets/icons/icon-32.png", "dist/assets/icons/icon-32.png");
await copyFile("assets/icons/icon-48.png", "dist/assets/icons/icon-48.png");
await copyFile("assets/icons/icon-128.png", "dist/assets/icons/icon-128.png");
