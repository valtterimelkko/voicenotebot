import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

// Only accept inbound ids that look safe to echo back in a header.
const INBOUND_ID_RE = /^[A-Za-z0-9_-]{4,128}$/;

/**
 * Tag every request with a correlatable id (uuid, or a validated inbound
 * X-Request-Id) and echo it on the response. Lets a user-facing error be tied
 * to the exact backend log line.
 */
export function requestId() {
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.header('x-request-id');
    const id = incoming && INBOUND_ID_RE.test(incoming) ? incoming : uuidv4();
    req.requestId = id;
    res.setHeader('X-Request-Id', id);
    next();
  };
}
