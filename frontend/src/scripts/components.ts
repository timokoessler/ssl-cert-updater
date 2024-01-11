export const errorAlert = (msg: string) => `<div class="alert alert-danger mt-3 mb-3">${msg}</div>`;
export const successAlert = (msg: string) => `<div class="alert alert-success mt-3 mb-3">${msg}</div>`;

export const loadingHtml = (msg = 'Lade Daten') =>
    `<div class="center-loading text-center"><div class="mb-3 d-none d-lg-block"> <div class="navbar-brand navbar-brand-autodark"><img src="/img/logo.svg" height="100" alt="${
        import.meta.env.PUBLIC_APP_NAME
    }"></div> </div> <div class="text-muted h2 mb-4">${msg}<span class="animated-dots"></span></div> <div class="progress progress-sm"><div class="progress-bar progress-bar-indeterminate"></div></div></div>`;

export const cardLoading = (txt = 'Bitte warten') =>
    `<div class="text-center my-3" style="margin:auto;"><div class="spinner-border big-spinner text-secondary" role="status"></div><div class="text-muted h2 mt-4">${txt}<span class="animated-dots"></span></div></div>`;

export const listGroupItem = (title: string, txt: string, id: string, iconClass: string) => `<a href="#" class="list-group-item-link mt-2" data-id="${id}">
        <div class="list-group-item">
            <div class="row align-items-center">
                <div class="col-auto"><i class="${iconClass}" style="font-size:32px;"></i></div>
                <div class="col">
                    <strong>${title}</strong>
                    <div class="d-block text-muted mt-n1">${txt}</div>
                </div>
                <div class="col-auto">
                    <i class="ti ti-chevron-right text-muted" style="font-size:32px;"></i>
                </div>
            </div>
        </div>
    </a>`;
