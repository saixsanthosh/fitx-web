import { startTransition, type FormEvent } from "react";
import { withSubmitter } from "@/components/form-rules";

/**
 * The submit handler of a content form. React resets a form after every `<form action>` call, which
 * would wipe what was typed when the server refuses a save and put saved fields back to their old
 * values. Sending the form data through a transition instead (with the default submit prevented)
 * leaves the fields as they are. Keep `action` on the form as well, so useFormStatus still works.
 * The pressed button's name and value go with the data, as the browser would send them.
 */
export function keepTyped(dispatch: (form: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = withSubmitter(new FormData(event.currentTarget), (event.nativeEvent as SubmitEvent | undefined)?.submitter);
    startTransition(() => dispatch(form));
  };
}
