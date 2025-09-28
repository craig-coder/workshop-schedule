import HeartbeatTest from "./components/HeartbeatTest";
import React from "react"
const SYNC_URL = import.meta.env.VITE_SYNC_URL; // Apps Script web app URL

const DEFAULT_SHEET_URL = "https://docs.google.com/spreadsheets/d/1Meojz6Ob41qPc2m-cvws24d1Zf7TTfqmo4cD_AFUOXU/edit?gid=270301091#gid=270301091"

// … all your functions here (unchanged) …

export default function App() {
  // … all your hooks and functions here (unchanged) …

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto grid gap-6">
        <header className="flex items-center justify-between gap-4 flex-wrap">
          {/* … existing header … */}
        </header>

        {error && <div className="text-sm text-red-600">{error}</div>}

        <section className="bg-white rounded-2xl shadow p-4 grid gap-3">
          {/* … existing search input … */}
        </section>

        <section className="bg-white rounded-2xl shadow p-4">
          {/* … existing table … */}
        </section>

        {/* 👇 Added HeartbeatTest here */}
        <section className="bg-white rounded-2xl shadow p-4">
          <HeartbeatTest />
        </section>

        <footer className="text-xs text-gray-500 text-center">
          Weights, mandato
