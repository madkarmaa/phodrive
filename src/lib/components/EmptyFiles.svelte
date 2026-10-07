<script lang="ts">
    import catPhoto from '$assets/empty-files-cat.png';
    import { APP_MOTTO } from '$lib/app';
</script>

<div class="empty-files" role="status">
    <div class="cat-illustration" aria-hidden="true">
        <img src={catPhoto} alt="" width="1254" height="1254" draggable="false" />
    </div>
    <h3>{APP_MOTTO}</h3>
    <p>
        <span class="desktop-hint">Drag your files here or use Upload to add your first file.</span>
        <span class="mobile-hint">Use Upload to add your first file.</span>
    </p>
</div>

<style>
    .empty-files {
        display: grid;
        justify-items: center;
        gap: 12px;
        max-width: 560px;
        text-align: center;
    }

    .cat-illustration {
        width: 200px;
        max-width: 100%;
        margin-bottom: 28px;
    }

    .cat-illustration img {
        display: block;
        width: 100%;
        height: auto;
    }

    h3 {
        color: var(--np-color-on-surface);
        font-size: 24px;
        font-weight: 400;
        line-height: 32px;
    }

    p {
        color: var(--np-color-on-surface-variant);
        font-size: 16px;
        line-height: 24px;
    }

    .desktop-hint {
        display: none;
    }

    @media (width > 800px) and (hover: hover) and (pointer: fine) {
        .desktop-hint {
            display: inline;
        }

        .mobile-hint {
            display: none;
        }
    }

    @media (width < 520px) {
        .cat-illustration {
            width: 160px;
            margin-bottom: 20px;
        }

        h3 {
            font-size: 22px;
            line-height: 28px;
        }

        p {
            font-size: 14px;
            line-height: 22px;
        }
    }
</style>
