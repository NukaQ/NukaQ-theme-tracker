// 静的サイトとして書き出す（out/ フォルダ）。
// GitHub Pages でリポジトリ名のサブパスに置く場合は NEXT_PUBLIC_BASE_PATH=/リポジトリ名 を指定する。
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** @type {import('next').NextConfig} */
export default {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
};
