import os
import sys
from pathlib import Path

os.environ.setdefault("VECTOR_STORE", "milvus")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.db import list_products, sync_product_documents
from backend.vector_store import vector_store_status


def main():
    products = list_products({})
    sync_product_documents()
    status = vector_store_status()
    print(f"Synced {len(products)} product documents")
    print(f"Vector store active: {status['active']}")
    print(f"Milvus URI: {status['uri']}")
    print(f"Collection: {status['collection']}")


if __name__ == "__main__":
    main()
