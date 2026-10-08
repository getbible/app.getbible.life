import Image from "next/image";
import { Fragment } from "react";
import "./infrastructure-credit.css";

export function InfrastructureCredit({ message }: { message: string }) {
  return <footer className="infrastructure-credit">
    <p>{message.split(/(\{getBible\})/g).map((part, index) => part === "{getBible}"
      ? <a key={index} href="https://getbible.net/" target="_blank" rel="noreferrer">
        <Image src="/favicon.svg" width={17} height={17} alt="" aria-hidden="true" unoptimized />
        <span>getBible</span>
      </a>
      : <Fragment key={index}>{part}</Fragment>)}</p>
  </footer>;
}
