import { startTransition, type FormEvent } from "react";

/**
 * The submit handler of a content form. React resets a form after every `<form action>` call, which
 * would wipe what was typed when the server refuses a save and put saved fields back to their old
 * values. Sending the form data through a transition instead (with the default submit prevented)
 * leaves the fields as they are. Keep `action` on the form as well, so useFormStatus still works.
 */
export function keepTyped(dispatch: (form: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(() => dispatch(form));
  };
}
