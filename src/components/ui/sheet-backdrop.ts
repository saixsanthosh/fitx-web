/**
 * Which clicks on a Sheet's backdrop close it. A tap on the backdrop does. A press that began inside the sheet and ends
 * over the backdrop (a drag that selects a field's text, say) sends its click to the dialog too, the nearest element
 * holding both ends; that must not close a form and lose what was typed (nutrition review N7, bug 13). So a click
 * closes the sheet only when it is on the backdrop and the press it ends began there. Escape and Close are unchanged.
 */
export type BackdropTaps = {
  /** A pointer went down, on the backdrop (the dialog element itself) or inside the sheet. */
  press: (onBackdrop: boolean) => void;
  /** A click arrived, on the backdrop or inside the sheet: true when it closes the sheet. */
  click: (onBackdrop: boolean) => boolean;
};

/** One Sheet's record of where the press now ending began. */
export function backdropTaps(): BackdropTaps {
  let pressedOnBackdrop = false;
  return {
    press: (onBackdrop) => {
      pressedOnBackdrop = onBackdrop;
    },
    click: (onBackdrop) => {
      const closes = pressedOnBackdrop && onBackdrop;
      pressedOnBackdrop = false;
      return closes;
    },
  };
}
