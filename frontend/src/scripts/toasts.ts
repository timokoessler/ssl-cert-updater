/* eslint-disable @typescript-eslint/ban-ts-comment */
function prepareToastContainer() {
    if (document.getElementById('toast-container')) return document.getElementById('toast-container')!;
    const toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.className = 'toast-container position-fixed bottom-0 end-0 p-3';
    document.body.appendChild(toastContainer);
    return toastContainer;
}

const basicToast = (
    msg: string,
    color: string,
) => `<div class="toast align-items-center text-bg-${color} border-0" role="alert" aria-live="assertive" aria-atomic="true">
    <div class="d-flex">
        <div class="toast-body">
            ${msg}
        </div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
    </div>
    </div>`;

export function showErrorToast(msg: string, delay = 5000) {
    const toastContainer = prepareToastContainer();
    toastContainer.innerHTML = basicToast(msg, 'danger');
    // @ts-ignore
    const toast = new bootstrap.Toast(toastContainer.querySelector('.toast'), {
        delay: delay,
    });
    toast.show();
}
