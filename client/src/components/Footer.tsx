interface FooterProps {
  version: string;
}

export function Footer({ version }: FooterProps): JSX.Element {
  return (
    <footer className="foot">
      <a href="http://17aitech.com" target="_blank" rel="noopener noreferrer">
        by domonic · 17aitech.com
      </a>
      <br />
      WorkBuddy 1024 造物挑战 · 云服务驱动 · <span style={{ opacity: 0.7 }}>v{version}</span>
    </footer>
  );
}
