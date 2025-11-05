import { Router, Request, Response } from "express";

class CaseCentreController {
  router = Router();
  constructor() {
    this.router.post("/get-educator-url", this.getEducatorUrl);
    this.router.post("/get-student-url", this.getStudentUrl);
  }

  async getEducatorUrl(req: Request, res: Response) {
    const data = (req as any).caseCentrePayload;
    res.status(200).send({
      success: true,
      url: `https://yourdomain.com/educator/dashboard/${data.token_id}`,
    });
  }

  async getStudentUrl(req: Request, res: Response) {
    const data = (req as any).caseCentrePayload;
    res.status(200).send({
      success: true,
      url: `https://yourdomain.com/student/experience/${data.token_id}`,
    });
  }
}

export default new CaseCentreController().router;
