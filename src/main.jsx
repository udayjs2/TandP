import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import TrackOrder from "./components/TrackOrder.jsx";
import { AgreementPage, FeedbackPage } from "./components/CustomerPages.jsx";

const q = new URLSearchParams(window.location.search);
const page = q.get("track") === "1" ? <TrackOrder /> : q.get("agree") === "1" ? <AgreementPage /> : q.get("feedback") === "1" ? <FeedbackPage /> : <App />;

ReactDOM.createRoot(document.getElementById("root")).render(<React.StrictMode>{page}</React.StrictMode>);
