// Ambient augmentation so every Express Request carries a correlatable id
// set by the requestId middleware. Imported once via app.ts.
declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
  }
}

export {};
