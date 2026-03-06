import localFont from 'next/font/local';
import "./globals.css";

const eidraSans = localFont({
  src: [
    { path: './fonts/EidraSans-Regular.woff2',       weight: '400', style: 'normal' },
    { path: './fonts/EidraSans-RegularItalic.woff2', weight: '400', style: 'italic' },
    { path: './fonts/EidraSans-Bold.woff2',          weight: '700', style: 'normal' },
    { path: './fonts/EidraSans-BoldItalic.woff2',    weight: '700', style: 'italic' },
  ],
  variable: '--font-eidra',
  display: 'swap',
});

export const metadata = {
  title: "Colour Contrast Checker",
  description: "Check WCAG colour contrast ratios for accessibility compliance.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={eidraSans.variable}>
      <body>{children}</body>
    </html>
  );
}