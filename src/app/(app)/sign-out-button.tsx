import { secondaryButtonClasses } from "@/components/ui/form";
import { signOut } from "./sign-out-action";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <button type="submit" className={secondaryButtonClasses}>
        Sign out
      </button>
    </form>
  );
}
