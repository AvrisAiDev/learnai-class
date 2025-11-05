export interface PurchaseAccessRequest {
  educator_id: number;
  organisation_id: number;
  product_id: string;
  course_id: string;
  quantity: number;
  expiry_datetime: number;
}

export interface GetEducatorUrlRequest {
  educator_id: number;
  token_id: string;
}

export interface GetStudentUrlRequest {
  student_id: number;
  token_id: string;
}
