from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR / "backend"))

from app.db import Database
from app.importer import import_current_state_into_db
from app.skill_generator import render_code_review_skill_md, render_skill_md


def main() -> None:
    parser = argparse.ArgumentParser(description="Import legacy markdown task board into Kanbanana SQLite DB")
    parser.add_argument("--slug", default=os.environ.get("KANBANANA_DEFAULT_PROJECT") or os.environ.get("KANBANANNA_DEFAULT_PROJECT", "default"), help="Project slug")
    parser.add_argument("--dir", default=str(ROOT_DIR / "docs" / "CURRENT_STATE"), help="Path to markdown docs dir")
    args = parser.parse_args()

    docs_dir = Path(args.dir)
    if not docs_dir.exists():
        print(f"Docs directory '{docs_dir}' does not exist; nothing to import.")
        return

    db = Database()
    summary = import_current_state_into_db(db, docs_dir, project_slug=args.slug)
    print("Import complete:", summary)

    proj = db.get_project(args.slug)
    if proj:
        generated_skill = render_skill_md(proj)
        gen_path = docs_dir / "SKILL.generated.md"
        gen_path.write_text(generated_skill, encoding="utf-8")
        print(f"Wrote updated agent skill preview to {gen_path}")

        review_skill = render_code_review_skill_md(proj)
        rev_doc_path = docs_dir / "CODE_REVIEW_SKILL.md"
        rev_doc_path.write_text(review_skill, encoding="utf-8")

        ws_skill_path = ROOT_DIR / ".agents" / "skills" / f"{args.slug}-code-review" / "SKILL.md"
        ws_skill_path.parent.mkdir(parents=True, exist_ok=True)
        ws_skill_path.write_text(review_skill, encoding="utf-8")
        print(f"Wrote code review skill to {rev_doc_path} and {ws_skill_path}")


if __name__ == "__main__":
    main()
