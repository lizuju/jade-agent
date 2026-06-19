import hashlib
import json
import math
import os
import re
from pathlib import Path
from urllib import request


ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

try:
    from pymilvus import MilvusClient
except Exception:
    MilvusClient = None


_CLIENTS = {}
_LOADED_COLLECTIONS = set()


def vector_store_mode():
    return os.environ.get("VECTOR_STORE", "auto").strip().lower()


def vector_store_enabled():
    return vector_store_mode() not in {"0", "false", "off", "sqlite", "none"}


def vector_store_required():
    return vector_store_mode() == "milvus"


def vector_dimension():
    return int(os.environ.get("MILVUS_EMBEDDING_DIM") or "384")


def embedding_provider():
    return os.environ.get("VECTOR_EMBEDDING_PROVIDER", "hash").strip().lower()


def milvus_uri():
    uri = os.environ.get("MILVUS_URI")
    if uri:
        return uri
    return str(DATA_DIR / "jade-agent-milvus.db")


def milvus_collection():
    return os.environ.get("MILVUS_COLLECTION", "jade_product_documents")


def tokenize(text):
    source = str(text or "").lower()
    tokens = re.findall(r"[a-z0-9]+|[\u4e00-\u9fff]", source)
    words = re.findall(r"[\u4e00-\u9fff]{2,}|[a-z0-9]+", source)
    for word in words:
        tokens.append(word)
        if re.match(r"[\u4e00-\u9fff]+$", word):
            tokens.extend(word[index:index + 2] for index in range(len(word) - 1))
    return tokens or ["empty"]


def normalize_vector(vector, dim=None):
    dim = dim or vector_dimension()
    values = [float(item) for item in (vector or [])[:dim]]
    if len(values) < dim:
        values.extend([0.0] * (dim - len(values)))
    norm = math.sqrt(sum(item * item for item in values))
    if not norm:
        return values
    return [item / norm for item in values]


def hash_embedding(text, dim=None):
    dim = dim or vector_dimension()
    vector = [0.0] * dim
    for token in tokenize(text):
        digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
        index = int.from_bytes(digest[:4], "little") % dim
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        vector[index] += sign * (1.0 + min(len(token), 8) * 0.05)
    return normalize_vector(vector, dim)


def ollama_embedding(text, dim=None):
    dim = dim or vector_dimension()
    model = os.environ.get("OLLAMA_EMBEDDING_MODEL", "nomic-embed-text")
    base_url = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
    timeout = float(os.environ.get("OLLAMA_EMBEDDING_TIMEOUT", "12"))
    payload = json.dumps({"model": model, "prompt": text}, ensure_ascii=False).encode("utf-8")
    req = request.Request(f"{base_url}/api/embeddings", data=payload, headers={"Content-Type": "application/json"}, method="POST")
    with request.urlopen(req, timeout=timeout) as response:
        data = json.loads(response.read().decode("utf-8"))
    return normalize_vector(data.get("embedding") or [], dim)


def embed_text(text):
    if embedding_provider() == "ollama":
        try:
            return ollama_embedding(text)
        except Exception:
            if vector_store_mode() == "milvus":
                raise
    return hash_embedding(text)


def get_client():
    if not vector_store_enabled() or MilvusClient is None:
        return None
    uri = milvus_uri()
    if uri not in _CLIENTS:
        _CLIENTS[uri] = MilvusClient(uri=uri)
    return _CLIENTS[uri]


def ensure_collection(client):
    name = milvus_collection()
    if not client.has_collection(collection_name=name):
        client.create_collection(collection_name=name, dimension=vector_dimension(), metric_type="COSINE")
    key = (milvus_uri(), name)
    if hasattr(client, "load_collection") and key not in _LOADED_COLLECTIONS:
        client.load_collection(collection_name=name)
        _LOADED_COLLECTIONS.add(key)
    return name


def product_vector_record(document):
    metadata = document.get("metadata") or {}
    return {
        "id": int(document["productId"]),
        "vector": document["embedding"],
        "product_id": int(document["productId"]),
        "chunk_type": document.get("chunkType") or "catalog_card",
        "content": document.get("content") or "",
        "metadata_json": json.dumps(metadata, ensure_ascii=False),
        "title": metadata.get("title") or "",
        "category": metadata.get("category") or "",
        "status": metadata.get("status") or "",
        "price": int(metadata.get("price") or 0),
    }


def upsert_product_vector(document):
    client = get_client()
    if not client:
        return False
    collection = ensure_collection(client)
    record = product_vector_record(document)
    if hasattr(client, "upsert"):
        client.upsert(collection_name=collection, data=[record])
    else:
        client.delete(collection_name=collection, ids=[record["id"]])
        client.insert(collection_name=collection, data=[record])
    return True


def quoted(value):
    return json.dumps(str(value or ""), ensure_ascii=False)


def search_product_vectors(query, terms=None, category=None, limit=20):
    client = get_client()
    if not client:
        return []
    collection = ensure_collection(client)
    search_text = "\n".join([str(query or ""), " ".join(str(term) for term in (terms or []))])
    filters = ['status == "listed"']
    if category:
        filters.append(f"category == {quoted(category)}")
    results = client.search(
        collection_name=collection,
        data=[embed_text(search_text)],
        filter=" and ".join(filters),
        limit=max(limit, 1),
        output_fields=["product_id", "chunk_type", "content", "metadata_json", "title", "category", "status", "price"],
    )
    hits = results[0] if results else []
    normalized = []
    for hit in hits:
        entity = hit.get("entity", {}) if isinstance(hit, dict) else getattr(hit, "entity", {})
        raw_score = hit.get("distance", hit.get("score", 0)) if isinstance(hit, dict) else getattr(hit, "distance", 0)
        try:
            score = float(raw_score)
        except (TypeError, ValueError):
            score = 0.0
        metadata = {}
        try:
            metadata = json.loads(entity.get("metadata_json") or "{}")
        except (TypeError, json.JSONDecodeError):
            pass
        normalized.append({
            "productId": int(entity.get("product_id") or hit.get("id")),
            "chunkType": entity.get("chunk_type") or "catalog_card",
            "content": entity.get("content") or "",
            "metadata": metadata,
            "vectorScore": score,
        })
    return normalized


def vector_store_status():
    enabled = vector_store_enabled()
    return {
        "mode": vector_store_mode(),
        "enabled": enabled,
        "available": MilvusClient is not None,
        "uri": milvus_uri(),
        "collection": milvus_collection(),
        "dimension": vector_dimension(),
        "embeddingProvider": embedding_provider(),
        "active": bool(enabled and MilvusClient is not None),
    }
