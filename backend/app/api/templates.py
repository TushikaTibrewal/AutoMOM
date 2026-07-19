"""Template discovery and validated upload."""
import io
import shutil
import zipfile

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import Template, User
from app.services.sample import SAMPLE_ATTENDEES, SAMPLE_MEETING, SAMPLE_MOM
from app.services.template_engine import (
    TemplateEngineError,
    list_templates,
    render_html,
    validate_template_folder,
)
from app.utils.audit import record_audit
from app.utils.security import get_current_user

router = APIRouter(prefix="/api", tags=["templates"])
settings = get_settings()

ALLOWED_TEMPLATE_FILES = {".html", ".css", ".json", ".png", ".jpg", ".jpeg", ".svg", ".ttf", ".otf", ".woff", ".woff2"}


@router.get("/templates", response_model=list[dict])
def get_templates(db: Session = Depends(get_db)):
    found = list_templates()
    # Sync DB registry (template versioning)
    for t in found:
        row = db.scalar(select(Template).where(Template.slug == t["slug"]))
        if row is None:
            db.add(Template(slug=t["slug"], name=t["name"], description=t["description"], version=t["version"]))
        elif row.version != t["version"]:
            row.version = t["version"]
            row.name = t["name"]
            row.description = t["description"]
    db.commit()
    return found


@router.get("/templates/{slug}/preview", response_class=HTMLResponse)
def preview_template(slug: str):
    """Render the template with canned sample data — used for preview cards."""
    try:
        html = render_html(SAMPLE_MEETING, SAMPLE_ATTENDEES, SAMPLE_MOM, slug)
    except TemplateEngineError:
        raise HTTPException(status_code=404, detail="Unknown template")
    return HTMLResponse(content=html)


@router.post("/template/upload", status_code=201)
def upload_template(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload a zip containing one template folder (meta.json + template.html)."""
    if not (file.filename or "").lower().endswith(".zip"):
        raise HTTPException(status_code=415, detail="Upload must be a .zip archive")
    raw = file.file.read(settings.max_upload_bytes + 1)
    if len(raw) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="Archive too large")

    try:
        archive = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=422, detail="Corrupt zip archive")

    slug = (file.filename or "template")[:-4].lower()
    slug = "".join(c if c.isalnum() or c in "-_" else "-" for c in slug).strip("-") or "uploaded"
    target = settings.templates_dir / slug
    if target.exists():
        raise HTTPException(status_code=409, detail=f"Template '{slug}' already exists")

    staging = settings.templates_dir / f".staging-{slug}"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)

    try:
        for member in archive.infolist():
            if member.is_dir():
                continue
            name = member.filename.replace("\\", "/")
            # Zip-slip protection + flatten single top-level folder
            parts = [p for p in name.split("/") if p not in ("", ".", "..")]
            if not parts or ".." in name:
                continue
            flat = parts[-1]
            ext = "." + flat.rsplit(".", 1)[-1].lower() if "." in flat else ""
            if ext not in ALLOWED_TEMPLATE_FILES:
                raise HTTPException(status_code=422, detail=f"File type not allowed: {flat}")
            (staging / flat).write_bytes(archive.read(member))

        validate_template_folder(staging)
        staging.rename(target)
    except TemplateEngineError as exc:
        shutil.rmtree(staging, ignore_errors=True)
        raise HTTPException(status_code=422, detail=str(exc))
    except HTTPException:
        shutil.rmtree(staging, ignore_errors=True)
        raise

    record_audit(db, current_user.id, "template.upload", slug)
    return {"slug": slug, "message": "Template installed"}
