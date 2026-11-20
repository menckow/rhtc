import Script from "next/script";

export default function HomePage() {
  return (
    <>
      <div id="app" />
      <Script src="/app.js" strategy="afterInteractive" />
    </>
  );
}
