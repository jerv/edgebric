import logoLight from "../../assets/logo-black.svg";
import logoDark from "../../assets/logo-white.svg";

interface LogoProps {
  className?: string;
  alt?: string;
}

export default function Logo({ className = "", alt = "Edgebric" }: LogoProps) {
  return (
    <>
      <img src={logoLight} alt={alt} className={`dark:!hidden ${className}`} />
      <img src={logoDark} alt={alt} className={`!hidden dark:!block ${className}`} />
    </>
  );
}
