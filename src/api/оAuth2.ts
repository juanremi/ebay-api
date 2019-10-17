import debug from 'debug';
import {LimitedRequest, createRequest} from '../utils/request';
import {Scope} from '../types';

const log = debug('ebay:oauth');

type Token = {
    access_token: string,
    expires_in: number, // default 2 hours
    token_type: string
}

// User Access Token
type UserAccessToken = Token & {
    refresh_token: string,
    refresh_token_expires_in: number
};

const defaultScopes: Scope = ['https://api.ebay.com/oauth/api_scope'];

export default class OAuth2 {
    // If all the calls in our application require just an Application access token
    static IDENTITY_ENDPOINT: any = {
        production: 'https://api.ebay.com/identity/v1/oauth2/token',
        sandbox: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token'
    };

    static AUTHORIZE_ENDPOINT: any = {
        production: 'https://auth.ebay.com/oauth2/authorize',
        sandbox: 'https://auth.sandbox.ebay.com/oauth2/authorize'
    };

    readonly appId: string;
    readonly certId: string;
    readonly sandbox: boolean;
    readonly ruName?: string;
    readonly req: LimitedRequest;

    private scope: Scope;

    private _clientToken?: Token;
    private _userAccessToken?: UserAccessToken;

    private readonly endpoint: string;

    constructor(
        appId: string,
        certId: string,
        sandbox: boolean,
        scopes: Scope = defaultScopes,
        ruName?: string,
        req: LimitedRequest = createRequest()
    ) {
        this.appId = appId;
        this.certId = certId;
        this.sandbox = sandbox;
        this.endpoint = sandbox ? 'sandbox' : 'production';
        this.scope = scopes;
        this.ruName = ruName;
        this.req = req;
    }

    /**
     * Return the access token.
     */
    async getAccessToken() {
        // Fallback to Client Token
        return this.accessToken || this.getClientAccessToken();
    }

    get accessToken() {
        if (this._userAccessToken) {
            return this._userAccessToken.access_token;
        }

        return null;
    }

    async getClientAccessToken(): Promise<string> {
        if (this._clientToken) {
            log('Return existing client token: ', this._clientToken);
            return this._clientToken.access_token;
        }

        try {
            const token = await this.refreshClientToken();
            return token.access_token;
        } catch (e) {
            throw e;
        }
    }

    public setClientToken(clientToken: Token) {
        this._clientToken = clientToken;
    }

    public setScope(scope: Scope) {
        this.scope = scope;
    }

    public getScope() {
        return [...this.scope];
    }

    // Client Credential Grant
    public async refreshClientToken(): Promise<Token> {
        if (!this.appId) throw new Error('Missing App ID (Client Id)');
        if (!this.certId) throw new Error('Missing Cert Id (Client Secret)');

        log('Obtain a new Client Token with scope: ', this.scope);

        try {
            const token = await this.req.postForm(OAuth2.IDENTITY_ENDPOINT[this.endpoint], {
                scope: this.scope.join(' '),
                grant_type: 'client_credentials'
            }, {
                auth: {
                    username: this.appId,
                    password: this.certId
                }
            });

            log('Stored a new Client Token:', token);
            this.setClientToken(token);
            return token;
        } catch (ex) {
            log('Failed to store client token', ex);
            throw ex;
        }
    }

    public static generateAuthUrl(sandbox: boolean, appId: string, ruName: string, scope: string[], state = ''): string {
        return [
            OAuth2.AUTHORIZE_ENDPOINT[sandbox ? 'sandbox' : 'production'],
            '?client_id=', encodeURIComponent(appId),
            '&redirect_uri=', encodeURIComponent(ruName),
            '&response_type=code',
            '&state=', encodeURIComponent(state),
            '&scope=', encodeURIComponent(scope.join(' '))
        ].join('');
    }

    /**
     * Generates URL for consent page landing.
     *
     * @param ruName RuName
     * @param scope the scopes
     * @param state state parameter returned in the redirect URL
     */
    generateAuthUrl(ruName?: string, scope: string[] = this.scope, state = ''): string {
        ruName = ruName || this.ruName;

        if (!ruName) {
            throw new Error('RuName is required.');
        }

        return OAuth2.generateAuthUrl(this.sandbox, this.appId, ruName, scope, state);
    }

    /**
     * Gets the access token for the given code.
     *
     * @param code the code
     * @param ruName the redirectUri
     */
    async getToken(code: string, ruName = this.ruName) {
        try {
            const token = await this.req.postForm(OAuth2.IDENTITY_ENDPOINT[this.endpoint], {
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: ruName
            }, {
                auth: {
                    username: this.appId,
                    password: this.certId
                }
            });

            log('Successfully obtained a new User Access Token:', token);
            return token;
        } catch (ex) {
            log('Failed to get the token:', ex);
            throw ex;
        }
    }

    public setCredentials(userAccessToken: UserAccessToken) {
        this._userAccessToken = userAccessToken;
    }

    public async refreshAuthToken() {
        if (!this._userAccessToken) {
            log('Tried to refresh auth token before it was set.');
            throw new Error('Failed to refresh the token. Token is not set.');
        }

        try {
            const token = await this.req.postForm(OAuth2.IDENTITY_ENDPOINT[this.endpoint], {
                grant_type: 'refresh_token',
                refresh_token: this._userAccessToken.refresh_token,
                scope: this.scope.join(' ')
            }, {
                auth: {
                    username: this.appId,
                    password: this.certId
                }
            });
            log('Successfully refreshed token', token);
            this.setCredentials(token);
        } catch (ex) {
            log('Failed to refresh the token', ex);
            throw ex;
        }
    }

    async refreshToken() {
        if (this._userAccessToken) {
            return this.refreshAuthToken();
        } else if (this._clientToken) {
            return this.refreshClientToken();
        }

        throw new Error('To refresh a Token a client token or user access token must be already set.');
    }
}