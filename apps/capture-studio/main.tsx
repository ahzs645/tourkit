import { mountCaptureStudio } from "./mount";

const root = document.getElementById("root");
if (!root) throw new Error("The capture editor root is missing.");
mountCaptureStudio(root);
