import db from './db';
import { FilterQuery, Document } from 'mongoose';
import * as Sentry from '@sentry/node';
import { getUpdateUIEventTypes, updateUIEvent } from '../sockets/browser-socket';
import { log } from './log';

export async function getUser(filter: FilterQuery<User>): Promise<Document<string, null, User> & User> {
    return await getDocument<User>('User', filter);
}

export async function deleteUser(userID: string) {
    try {
        await deleteDocumentsQuery('Authenticator', { userID: userID });
        await deleteDocumentQuery('User', { _id: userID });
        return true;
    } catch (err) {
        Sentry.captureException(err);
        log('error', `Error on deleteUser: ${err.message}`);
        return false;
    }
}

export async function dbOperation<T>(operation: () => Promise<T>, collectionName: DBCollectionNames, operationType: string): Promise<T | undefined> {
    try {
        return await operation();
    } catch (err) {
        Sentry.captureException(err);
        log('error', `Error on db operation ${operationType} in ${collectionName}: ${err.message}`);
        return undefined;
    }
}

export async function createDocument<T>(collectionName: DBCollectionNames, document: T): Promise<boolean> {
    return (
        (await dbOperation(
            async () => {
                await db[collectionName as string]().create(document);

                const updateUIEventType = collectionName.toLowerCase() as UIUpdateEventType;
                if (getUpdateUIEventTypes().includes(updateUIEventType)) {
                    updateUIEvent(updateUIEventType);
                }
                return true;
            },
            collectionName,
            'createDocument',
        )) ?? false
    );
}

export async function getDocument<T>(collectionName: DBCollectionNames, filter: FilterQuery<T>): Promise<(Document<unknown, null, T> & T) | undefined> {
    return await dbOperation(
        async () => {
            return await db[collectionName as string]().findOne(filter);
        },
        collectionName,
        'getDocument',
    );
}

export async function getDocuments<T>(collectionName: DBCollectionNames, filter: FilterQuery<T>): Promise<(Document<unknown, null, T> & T)[] | undefined> {
    return await dbOperation(
        async () => {
            return await db[collectionName as string]().find(filter);
        },
        collectionName,
        'getDocuments',
    );
}

export async function saveDocument<T>(document: Document<unknown, null, T> & T): Promise<boolean> {
    return (
        (await dbOperation(
            async () => {
                await document.save();

                const updateUIEventType = document.collection.collectionName.toLowerCase().slice(0, -1) as UIUpdateEventType;
                if (getUpdateUIEventTypes().includes(updateUIEventType)) {
                    updateUIEvent(updateUIEventType);
                }
                return true;
            },
            document.collection.name.slice(0, -1) as DBCollectionNames,
            'saveDocument',
        )) ?? false
    );
}

export async function deleteDocument<T>(document: Document<unknown, null, T> & T): Promise<boolean> {
    return (
        (await dbOperation(
            async () => {
                await document.deleteOne();

                const updateUIEventType = document.collection.collectionName.toLowerCase().slice(0, -1) as UIUpdateEventType;
                if (getUpdateUIEventTypes().includes(updateUIEventType)) {
                    updateUIEvent(updateUIEventType);
                }
                return true;
            },
            document.collection.name.slice(0, -1) as DBCollectionNames,
            'deleteDocument',
        )) ?? false
    );
}

export async function deleteDocumentQuery<T>(collectionName: DBCollectionNames, filter: FilterQuery<T>): Promise<boolean> {
    return (
        (await dbOperation(
            async () => {
                await db[collectionName as string]().deleteOne(filter);

                const updateUIEventType = collectionName.toLowerCase() as UIUpdateEventType;
                if (getUpdateUIEventTypes().includes(updateUIEventType)) {
                    updateUIEvent(updateUIEventType);
                }
                return true;
            },
            collectionName,
            'deleteDocumentQuery',
        )) ?? false
    );
}

export async function deleteDocumentsQuery<T>(collectionName: DBCollectionNames, filter: FilterQuery<T>): Promise<boolean> {
    return (
        (await dbOperation(
            async () => {
                await db[collectionName as string]().deleteMany(filter);

                const updateUIEventType = collectionName.toLowerCase() as UIUpdateEventType;
                if (getUpdateUIEventTypes().includes(updateUIEventType)) {
                    updateUIEvent(updateUIEventType);
                }
                return true;
            },
            collectionName,
            'deleteDocumentsQuery',
        )) ?? false
    );
}

export async function deleteSSLCertFromConfigs(certID: string): Promise<boolean> {
    return (
        (await dbOperation(
            async () => {
                await db.Server().updateMany(
                    {},
                    {
                        $pull: {
                            'config.certs': {
                                _id: certID,
                            },
                        },
                    },
                );
                return true;
            },
            'Server',
            'deleteSSLCertFromConfigs',
        )) ?? false
    );
}
