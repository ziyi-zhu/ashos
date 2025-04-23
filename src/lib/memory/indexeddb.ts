const DB_NAME = 'Brain'; // had to call it that 
const DB_VERSION = 1;
const STORE_NAME = 'memories';

export interface MemoryRecord {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  embedding: number[];
  timestamp: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

// initializes db
function openDB(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        // maybe: Index for potentially filtering/sorting by timestamp later
        store.createIndex('timestamp', 'timestamp', { unique: false });
        //console.log(`Object store '${STORE_NAME}' created.`);
      }
    };

    request.onsuccess = (event) => {
      //console.log(`Database '${DB_NAME}' opened successfully.`);
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = () => {
      console.error('Error opening database:', request.error);
      dbPromise = null; 
      reject(`Error opening database: ${request.error}`);
    };
  });

  return dbPromise;
}

// helper to get a transaction and the object store
async function getStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openDB();
  const transaction = db.transaction(STORE_NAME, mode);
  return transaction.objectStore(STORE_NAME);
}

// adds a memory record to the db
export async function addRecord(record: Omit<MemoryRecord, 'id'>): Promise<number> {
  return new Promise(async (resolve, reject) => {
    const store = await getStore('readwrite');
    const request = store.add(record);

    request.onsuccess = () => {
      resolve(request.result as number);
    };

    request.onerror = () => {
      console.error('Error adding record:', request.error);
      reject(`Error adding record: ${request.error}`);
    };
  });
}

// memory retrieval 
export async function getRecord(id: number): Promise<MemoryRecord | undefined> {
  return new Promise(async (resolve, reject) => {
    const store = await getStore('readonly');
    const request = store.get(id);

    request.onsuccess = () => {
      resolve(request.result as MemoryRecord | undefined);
    };

    request.onerror = () => {
      console.error('Error getting record:', request.error);
      reject(`Error getting record: ${request.error}`);
    };
  });
}


export async function getAllRecords(): Promise<MemoryRecord[]> {
  return new Promise(async (resolve, reject) => {
    const store = await getStore('readonly');
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result as MemoryRecord[]);
    };

    request.onerror = () => {
      console.error('Error getting all records:', request.error);
      reject(`Error getting all records: ${request.error}`);
    };
  });
}

// delete a memory record from the db
export async function deleteRecord(id: number): Promise<void> {
  const db = await openDB();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  const request = store.delete(id);

  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      //console.log(`Record with ID ${id} deleted successfully.`);
      resolve();
    };
    request.onerror = (event) => {
      console.error(`Error deleting record with ID ${id}:`, (event.target as IDBRequest).error);
      reject((event.target as IDBRequest).error);
    };
    transaction.oncomplete = () => {};
    transaction.onerror = (event) => {
       console.error(`Transaction error deleting record ID ${id}:`, (event.target as IDBTransaction).error);
      reject((event.target as IDBTransaction).error); 
    }
  });
}

// clears all records from the db
export async function clearAllRecords(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      const store = await getStore('readwrite');
      const request = store.clear();

      request.onsuccess = () => {
          resolve();
      };

      request.onerror = () => {
          console.error('Error clearing store:', request.error);
          reject(`Error clearing store: ${request.error}`);
      };
    });
} 