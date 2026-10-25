void add_arrays(float *out, const float *a, const float *b, int n) {
    for (int i = 0; i < n; ++i)
        out[i] = a[i] + b[i];
}
