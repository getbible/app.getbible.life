import Image from "next/image";
import { Fragment } from "react";
import "./infrastructure-credit.css";

export function InfrastructureCredit({ message, slogan }: { message: string; slogan: string }) {
  return <footer className="infrastructure-credit">
    <span className="infrastructure-credit-logo-plate" aria-hidden="true">
      <Image className="infrastructure-credit-logo" src="/favicon.png" width={40} height={40} alt="" unoptimized />
    </span>
    <div className="infrastructure-credit-copy">
      <p className="infrastructure-credit-slogan">{slogan}</p>
      <p>{message.split(/(\{getBible\})/g).map((part, index) => part === "{getBible}"
        ? <a key={index} href="https://getbible.net/" target="_blank" rel="noreferrer">getBible</a>
        : <Fragment key={index}>{part}</Fragment>)}</p>
    </div>
  </footer>;
}
