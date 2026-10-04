// Shark Tank: the list of joinable tanks with live player counts + top score. Polls
// /api/tank every few seconds. Rendered as a semantic <table> (proper column
// headers, scope) with a keyboard-operable Join action per row.
//
// The table is the read; there is deliberately no live region mirroring it. A region
// holding every tank's counts is rewritten on each three-second poll — top score moves
// whenever anyone is playing — so it re-announced the whole tank-list sentence forever.
// What is announced instead is the handful of transitions a player waiting for a seat
// actually needs: a tank filling up, a tank opening again, a tank arriving or leaving.
// Score churn produces no diff and therefore no speech.

import { useEffect, useRef, useState } from "react";
import { API, type TankResponse, type TankRoom } from "../../protocol/index.js";
import { useAnnouncer } from "../a11y/announcer.js";

export function Lobby({
  playerName,
  onJoin,
  onBack,
  baseUrl = "",
}: {
  playerName: string;
  onJoin: (room: { id: string; name: string }) => void;
  onBack: () => void;
  baseUrl?: string;
}) {
  const [rooms, setRooms] = useState<TankRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const { announce } = useAnnouncer();
  const firstLoad = useRef(true);
  // Last poll's seat state per tank, the baseline every announcement is diffed against.
  const seen = useRef<Map<string, { name: string; full: boolean }>>(new Map());

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch(baseUrl + API.tank);
        const data = (await res.json()) as TankResponse;
        if (alive && data.ok) {
          setRooms(data.rooms);
          setLoading(false);
          const now = new Map(data.rooms.map((r) => [r.id, { name: r.name, full: r.players >= r.capacity }]));
          const before = seen.current;
          seen.current = now;
          if (firstLoad.current) {
            firstLoad.current = false;
            announce(data.rooms.length === 1 ? `${data.rooms[0]?.name ?? "SharkTank"} available.` : `${data.rooms.length} tanks available.`);
          } else {
            // One message per poll, listing only what moved. The announcer drops a message
            // identical to the one before it, which is survivable here because a tank cannot
            // fill twice without opening in between — the two "is full" lines are never
            // consecutive.
            const changes: string[] = [];
            for (const [id, state] of now) {
              const was = before.get(id);
              if (!was) changes.push(`${state.name} is now listed.`);
              else if (was.full !== state.full) changes.push(state.full ? `${state.name} is full.` : `${state.name} has space again.`);
            }
            for (const [id, was] of before) if (!now.has(id)) changes.push(`${was.name} is no longer listed.`);
            if (changes.length) announce(changes.join(" "));
          }
        }
      } catch {
        if (alive) setLoading(false);
      }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [announce]);

  return (
    <div className="center-screen">
      <div className="panel stack lobby-panel">
        <div className="spread">
          <h1 className="screen-title">Shark Tanks</h1>
          <button className="btn" onClick={onBack}>Back</button>
        </div>

        <div className="lobby-table-scroll">
          <table className="table">
            <caption className="sr-only">Available SharkTank server: 8 player seats plus 24 bots, with live player counts and top scores. Updated every three seconds.</caption>
            <thead>
              <tr>
                <th scope="col">Tank</th>
                <th scope="col">Sharks</th>
                <th scope="col">Top score</th>
                <th scope="col">Leader</th>
                <th scope="col"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody aria-busy={loading}>
              {loading && (
                <tr><td colSpan={5} className="text-muted">Loading tanks…</td></tr>
              )}
              {!loading && rooms.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className="font-strong">{r.name}</th>
                  <td className="tabular-nums">
                    {r.players + r.bots}/32
                    <span className="lobby-live-count">{r.players}/{r.capacity} live</span>
                  </td>
                  <td className="tabular-nums">{r.topScore}</td>
                  <td>{r.topName}</td>
                  <td className="text-right">
                    <button
                      className="btn btn--primary"
                      onClick={() => onJoin({ id: r.id, name: r.name })}
                      aria-label={`Join ${r.name}, ${r.players} of ${r.capacity} live players in a tank of ${r.players + r.bots} sharks, top score ${r.topScore}`}
                    >
                      Join
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
