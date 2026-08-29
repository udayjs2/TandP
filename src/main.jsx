import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import TrackOrder from "./components/TrackOrder.jsx";

const isTrackingPage = new URLSearchParams(window.location.search).get("track") === "1";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isTrackingPage ? <TrackOrder /> : <App />}
  </React.StrictMode>
);
