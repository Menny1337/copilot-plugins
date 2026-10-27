export class UserError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = "UserError";
    this.context = context;
  }
}
