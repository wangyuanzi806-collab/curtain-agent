export async function fileToDataUrl(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const mimeType = file.type || "image/jpeg";
  return `data:${mimeType};base64,${base64}`;
}

export function getFilesFromFormData(formData: FormData, field: string) {
  return formData.getAll(field).filter((item): item is File => item instanceof File);
}

export function validateImageFile(file: File, fieldName: string) {
  if (!file.type.startsWith("image/")) {
    throw new Error(`${fieldName} \u5fc5\u987b\u662f\u56fe\u7247\u6587\u4ef6\u3002`);
  }
}
