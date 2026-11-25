/**
 * A list of shots as the planner shows them: the one shot card (src/miniature/shotCard.js) at
 * its row size, each a link that opens that shot in `/plan/`. `/map` had rows of its own (a
 * dot, a serif time, two lines), which read as another product.
 */
import { useEffect, useRef } from 'react';
import { planLink } from '../../../home/grid.js';
import type { ShotRow } from '../../../miniature/dayShots.js';
import { shotCard } from '../../../miniature/shotCard.js';
import '../../../miniature/shotcard.css';

export default function ShotRows({ rows, now }: { rows: ShotRow[]; now: number }): JSX.Element {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    el.replaceChildren(
      ...rows.map((row) => {
        // No forecast is read on this page: the card says so rather than nothing.
        const card = shotCard(row, null, { size: 'row', tag: 'a' }) as HTMLAnchorElement;
        card.href = planLink(row);
        card.dataset.past = String((row.until ?? row.t) < now);
        return card;
      }),
    );
  }, [rows, now]);
  return <div className="ue-shotrows" ref={list} />;
}
