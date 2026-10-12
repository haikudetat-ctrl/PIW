import { secondaryButtonClasses } from "@/components/ui/form";
import { Icon } from "@/components/ui/icons";
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

export function SidebarSignOutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        aria-label="Sign out"
        title="Sign out"
        className="rounded-md p-1.5 text-ink-subtle transition hover:bg-fill-hover hover:text-ink"
      >
        <Icon name="signOut" />
      </button>
    </form>
  );
}
