/**
 * Global error-popup state. Any part of the app can call `errorDialog.show(...)`;
 * the single <ErrorModal/> rendered in the layout reacts to it.
 */
class ErrorDialog {
  open = $state(false);
  title = $state("");
  message = $state("");
  detail = $state("");

  show(title: string, message: string, detail = "") {
    this.title = title;
    this.message = message;
    this.detail = detail;
    this.open = true;
  }

  close() {
    this.open = false;
  }
}

export const errorDialog = new ErrorDialog();
